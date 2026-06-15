import { useState, useEffect } from 'react';
import { type User } from 'firebase/auth';
import {
  doc, getDoc, setDoc, addDoc, updateDoc, collection, serverTimestamp,
} from 'firebase/firestore';
import { useTranslation } from 'react-i18next';
import { db, auth } from './firebase';
import { ThumbImage, PROXY_BASE } from './shared';
import type { PhotoItem } from './shared';
import vowvyLogo from './assets/logo-mark.svg';
import './SellThisFlow.css';

// ---- Types ----------------------------------------------------------------

type SellingScope   = 'whole' | 'one' | 'few';
type ShippingIntent = 'local' | 'ship' | 'unsure';
type Step = 'loading' | 'confirm' | 'questions' | 'review' | 'platform' | 'copy';
type RewriteMode = 'shorter' | 'friendlier' | 'professional' | 'detail' | 'casual';

export interface ContainerForListing {
  id: string;
  name: string;
  location: string;
  photos: PhotoItem[];
  aiDescription: string;
  aiTags: string[];
}

interface Draft {
  title: string;
  description: string;
  condition: string;
  category: string;
  platforms: string[];
}

interface Props {
  user: User;
  container: ContainerForListing;
  sourcePhotos?: PhotoItem[];
  sourceContainerIds?: string[];
  isFromTray?: boolean;
  onClose: () => void;
}

// ---- Category & platform helpers ------------------------------------------

const LISTING_CATEGORIES = [
  'Home goods',
  'Furniture',
  'Electronics',
  'Clothing',
  'Collectibles',
  'Sports / memorabilia',
  'Toys / games',
  'Books / media',
  'Tools',
  'Kitchen',
  'Other',
];

// Collectibles checked first so memorabilia/vintage items win before Home goods.
const CATEGORY_KEYWORDS: [string[], string][] = [
  [['coin', 'stamp', 'card', 'collectible', 'antique', 'memorabilia',
    'signed', 'jersey', 'figurine', 'vintage'],                                     'Collectibles'],
  [['bike', 'bicycle', 'scooter', 'skateboard', 'skis', 'sport', 'gym',
    'fitness', 'ball', 'racket', 'tent', 'hiking', 'kayak'],                        'Sports / memorabilia'],
  [['table', 'chair', 'sofa', 'couch', 'dresser', 'desk', 'shelf', 'bookcase',
    'furniture', 'cabinet', 'wardrobe', 'bench', 'ottoman', 'stool'],               'Furniture'],
  [['phone', 'laptop', 'computer', 'tablet', 'camera', 'speaker', 'headphone',
    'electronic', 'monitor', 'keyboard', 'remote', 'console', 'printer'],           'Electronics'],
  [['shirt', 'pants', 'coat', 'jacket', 'dress', 'shoes', 'boots', 'clothing',
    'clothes', 'hat', 'bag', 'purse', 'belt', 'scarf', 'gloves'],                  'Clothing'],
  [['tool', 'drill', 'wrench', 'saw', 'hammer', 'screwdriver', 'toolbox',
    'level', 'clamp', 'chisel'],                                                    'Tools'],
  [['book', 'novel', 'textbook', 'magazine', 'manual', 'dvd', 'cd', 'vinyl'],      'Books / media'],
  [['toy', 'game', 'lego', 'doll', 'puzzle', 'kids', 'children', 'board game'],   'Toys / games'],
  [['pot', 'pan', 'dish', 'plate', 'cup', 'mug', 'kitchen', 'appliance',
    'blender', 'mixer', 'toaster', 'cutlery'],                                      'Kitchen'],
  [['lamp', 'light', 'bulb', 'chandelier', 'lantern', 'sconce',
    'plant', 'garden', 'patio', 'lawn', 'flower', 'planter', 'hose',
    'art', 'painting', 'print', 'frame', 'mirror', 'decor', 'vase', 'candle',
    'ceramic', 'rug', 'curtain',
    'stroller', 'crib', 'highchair', 'baby', 'infant', 'toddler'],                 'Home goods'],
];

function guessCategory(itemHint: string, aiTags: string[]): string {
  const text = [itemHint, ...aiTags].join(' ').toLowerCase();
  for (const [keywords, category] of CATEGORY_KEYWORDS) {
    if (keywords.some(k => text.includes(k))) return category;
  }
  return 'Other';
}

function guessPlatforms(shippingIntent: ShippingIntent, category: string): string[] {
  const vintageCategories = ['Home goods', 'Clothing', 'Books / media', 'Collectibles'];
  if (shippingIntent === 'local') return ['Facebook Marketplace', 'Craigslist'];
  if (shippingIntent === 'ship')  return vintageCategories.includes(category)
    ? ['Etsy', 'eBay', 'Facebook Marketplace']
    : ['eBay', 'Facebook Marketplace'];
  return ['Facebook Marketplace', 'Craigslist', 'eBay'];
}

// ---- Starter draft (no AI — composed from user input + container data) ----

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function buildDraft(
  container: ContainerForListing,
  sellingScope: SellingScope,
  itemHint: string,
  shippingIntent: ShippingIntent,
  userNotes: string,
  sourcePhotos?: PhotoItem[],
): Draft {
  const title = capitalize(itemHint.trim());

  const scopeIntro: string =
    sellingScope === 'whole' ? `${title} — everything shown in the photos.` :
    sellingScope === 'one'   ? `${title}. One item, pictured.` :
                               `${title}. A few items — see photos for details.`;

  const conditionPart = userNotes.trim()
    ? `\n\nCondition notes: ${userNotes.trim()}`
    : '\n\nCondition appears good based on photos. Please review all photos carefully before purchasing.';

  const shippingPart: string =
    shippingIntent === 'local' ? '\n\nLocal pickup only. Cash preferred.' :
    shippingIntent === 'ship'  ? '\n\nWilling to ship — buyer pays actual shipping cost.' :
                                 '\n\nLocal pickup preferred; may consider shipping.';

  const description = scopeIntro + conditionPart + shippingPart;
  const condition   = userNotes.trim() || 'See photos for condition details.';
  const tagsForCategory = sourcePhotos?.flatMap(p => p.aiTags ?? []).length
    ? sourcePhotos.flatMap(p => p.aiTags ?? [])
    : container.aiTags;
  const category    = guessCategory(itemHint, tagsForCategory);
  const platforms   = guessPlatforms(shippingIntent, category);

  return { title, description, condition, category, platforms };
}

// ---- Simple rule-based rewrites (no AI required) --------------------------

function rewriteDraft(draft: Draft, mode: RewriteMode, container: ContainerForListing): Draft {
  const stripOpener = (s: string) =>
    s.replace(/^(For sale|Selling this|Up for grabs)[!:]\s*/i, '');

  switch (mode) {
    case 'shorter': {
      const parts = draft.description.split('\n\n').filter(Boolean);
      const shorter = parts.slice(0, 2).join('\n\n');
      return { ...draft, description: shorter || draft.description };
    }
    case 'friendlier': {
      const body = stripOpener(draft.description);
      return { ...draft, description: `Up for grabs! ${capitalize(body)}` };
    }
    case 'professional': {
      const body = stripOpener(draft.description);
      const lowered = body.charAt(0).toLowerCase() + body.slice(1);
      return { ...draft, description: `For sale: ${lowered}` };
    }
    case 'casual': {
      const body = stripOpener(draft.description);
      const lowered = body.charAt(0).toLowerCase() + body.slice(1);
      return { ...draft, description: `Selling this — ${lowered}` };
    }
    case 'detail': {
      const tags = container.aiTags.slice(0, 8).join(', ');
      const extra = tags ? `\n\nItems visible in photos: ${tags}.` : '';
      const notesText = container.aiDescription?.trim()
        ? ''
        : extra;
      return { ...draft, description: draft.description + notesText + extra };
    }
    default:
      return draft;
  }
}

// ---- Platform open URLs ---------------------------------------------------

const PLATFORM_URLS: Record<string, string> = {
  'Facebook Marketplace': 'https://www.facebook.com/marketplace/create/item',
  'Craigslist':           'https://post.craigslist.org/',
  'Etsy':                 'https://www.etsy.com/sell',
  'eBay':                 'https://www.ebay.com/sl/sell',
};

const ALL_PLATFORMS = ['Facebook Marketplace', 'Craigslist', 'Etsy', 'eBay', 'Other'];

// ---- Photo filename helpers -----------------------------------------------

function slugify(s: string, maxLen = 30): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, maxLen)
    .replace(/-$/, '');
}

function extFromMimeType(mimeType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png':  'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heic',
    'image/gif':  'gif',
  };
  return map[mimeType.toLowerCase()] ?? 'jpg';
}

function buildPhotoFilename(photo: PhotoItem, index: number, titleSlug: string, ext = 'jpg'): string {
  const prefix = String(index + 1).padStart(2, '0');
  const descriptor =
    photo.aiObjects?.[0] ||
    photo.aiTags?.[0] ||
    photo.description?.trim() ||
    titleSlug;
  const slug = slugify(descriptor || 'photo', 20) || 'photo';
  return `${prefix}-${slug}.${ext}`;
}

const FILE_SYSTEM_ACCESS_SUPPORTED =
  typeof window !== 'undefined' && 'showDirectoryPicker' in window;

function looksLikeListingFolder(name: string): boolean {
  if (/^VOWVY - .+ - \d{4}-\d{2}-\d{2} \d{4}$/.test(name)) return true;
  const lower = name.toLowerCase();
  return lower.includes('listing') || lower.includes('marketplace');
}

let savedParentDir: any = null;

// ---- Download button (fetch-blob approach) --------------------------------

function DownloadPhotoBtn({ photo, index, titleSlug }: { photo: PhotoItem; index: number; titleSlug: string }) {
  const [loading, setLoading] = useState(false);

  async function handleDownload() {
    if (loading) return;
    setLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      const proxyUrl = `${PROXY_BASE}?path=${encodeURIComponent(photo.storagePath)}`;
      const res = await fetch(proxyUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const blob = await res.blob();
      const ext = extFromMimeType(blob.type);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = buildPhotoFilename(photo, index, titleSlug, ext);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch { /* silently fail */ } finally {
      setLoading(false);
    }
  }

  return (
    <button className="sell-download-btn" onClick={handleDownload} disabled={loading}>
      {loading ? '…' : buildPhotoFilename(photo, index, titleSlug)}
    </button>
  );
}

// ---- Component ------------------------------------------------------------

export default function SellThisFlow({ user, container, sourcePhotos, sourceContainerIds, isFromTray, onClose }: Props) {
  const { t } = useTranslation();
  const [step, setStep]                   = useState<Step>('loading');
  const [sellingScope, setSellingScope]   = useState<SellingScope>(() => {
    if (isFromTray) return 'few';
    if (sourcePhotos) return sourcePhotos.length === 1 ? 'one' : 'few';
    return 'whole';
  });
  const [itemHint, setItemHint]           = useState('');
  const [shippingIntent, setShippingIntent] = useState<ShippingIntent>('local');
  const [userNotes, setUserNotes]         = useState('');
  const [draft, setDraft]                 = useState<Draft | null>(null);
  const [listingId, setListingId]         = useState<string | null>(null);
  const [selectedPlatform, setSelectedPlatform] = useState('');
  const [postedUrl, setPostedUrl]         = useState('');
  const [titleCopied, setTitleCopied]     = useState(false);
  const [descCopied, setDescCopied]       = useState(false);
  const [urlSaved, setUrlSaved]           = useState(false);
  const [saving, setSaving]               = useState(false);
  const [brandingNote, setBrandingNote]   = useState(true);
  const [editedCategory, setEditedCategory] = useState('');
  const [folderState, setFolderState]     = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [folderName, setFolderName]       = useState('');
  const [folderWarn, setFolderWarn]       = useState(false);
  const [savedLocationName, setSavedLocationName] = useState<string>(() => savedParentDir?.name ?? '');

  useEffect(() => {
    getDoc(doc(db, 'users', user.uid)).then(snap => {
      const data = snap.data();
      setStep(data?.listingConfirmationAcceptedAt ? 'questions' : 'confirm');
    }).catch(() => setStep('confirm'));
  }, [user.uid]);

  async function handleConfirm() {
    await setDoc(
      doc(db, 'users', user.uid),
      { listingConfirmationAcceptedAt: serverTimestamp() },
      { merge: true },
    );
    setStep('questions');
  }

  async function handleCreateDraft() {
    if (!itemHint.trim() || saving) return;
    setSaving(true);
    try {
      const d = buildDraft(container, sellingScope, itemHint, shippingIntent, userNotes, sourcePhotos);
      const photoIds = (sourcePhotos ?? container.photos.filter(p => !p.deletedAt))
        .filter(p => !p.deletedAt)
        .map(p => p.id);

      const ref = await addDoc(
        collection(db, `users/${user.uid}/listings`),
        {
          containerId:          sourceContainerIds ? null : container.id,
          sourceContainerIds:   sourceContainerIds ?? [],
          photoIds,
          sellingScope,
          itemHint:             itemHint.trim(),
          shippingIntent,
          userNotes:            userNotes.trim(),
          generatedTitle:       d.title,
          generatedDescription: d.description,
          generatedCondition:   d.condition,
          generatedCategory:    d.category,
          suggestedPlatforms:   d.platforms,
          selectedPlatform:     '',
          postedUrl:            '',
          status:               'draft',
          createdAt:            serverTimestamp(),
          updatedAt:            serverTimestamp(),
        },
      );
      setListingId(ref.id);
      setDraft(d);
      setEditedCategory(d.category);
      setStep('review');
    } finally {
      setSaving(false);
    }
  }

  async function handleRewrite(mode: RewriteMode) {
    if (!draft) return;
    const newDraft = rewriteDraft(draft, mode, container);
    setDraft(newDraft);
    if (listingId) {
      await updateDoc(doc(db, `users/${user.uid}/listings/${listingId}`), {
        generatedTitle:       newDraft.title,
        generatedDescription: newDraft.description,
        updatedAt:            serverTimestamp(),
      });
    }
  }

  async function handleSelectPlatform(platform: string) {
    setSelectedPlatform(platform);
    if (listingId) {
      await updateDoc(doc(db, `users/${user.uid}/listings/${listingId}`), {
        selectedPlatform: platform,
        updatedAt:        serverTimestamp(),
      });
    }
    setStep('copy');
  }

  async function handleSavePostedUrl() {
    if (!postedUrl.trim() || !listingId || urlSaved) return;
    await updateDoc(doc(db, `users/${user.uid}/listings/${listingId}`), {
      postedUrl: postedUrl.trim(),
      status:    'posted',
      updatedAt: serverTimestamp(),
    });
    setUrlSaved(true);
  }

  async function copyText(text: string, onCopied: (b: boolean) => void) {
    await navigator.clipboard.writeText(text);
    onCopied(true);
    setTimeout(() => onCopied(false), 2000);
  }

  async function handlePrepareFolder() {
    if (!draft || folderState === 'working') return;
    setFolderState('working');
    setFolderWarn(false);
    try {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}${pad(now.getMinutes())}`;
      const titlePart = draft.title.replace(/[^a-zA-Z0-9\s]/g, '').trim().slice(0, 40);
      const name = `VOWVY - ${titlePart} - ${dateStr}`;

      const token = await auth.currentUser?.getIdToken();
      if (!token) { setFolderState('error'); return; }

      let parentDir = savedParentDir;
      if (!parentDir) {
        parentDir = await (window as any).showDirectoryPicker({
          mode: 'readwrite',
          startIn: 'downloads',
        });
        if (looksLikeListingFolder(parentDir.name)) {
          setFolderState('idle');
          setFolderWarn(true);
          return;
        }
        savedParentDir = parentDir;
        setSavedLocationName(parentDir.name);
      }

      const listingDir = await parentDir.getDirectoryHandle(name, { create: true });

      const exportPhotos = (sourcePhotos ?? container.photos.filter(p => !p.deletedAt))
        .filter(p => !p.deletedAt);
      const titleSlug = slugify(draft.title, 30);

      for (let i = 0; i < exportPhotos.length; i++) {
        const photo = exportPhotos[i];
        const proxyUrl = `${PROXY_BASE}?path=${encodeURIComponent(photo.storagePath)}`;
        const res = await fetch(proxyUrl, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) continue;
        const blob = await res.blob();
        const ext = extFromMimeType(blob.type);
        const filename = buildPhotoFilename(photo, i, titleSlug, ext);
        const fileHandle = await listingDir.getFileHandle(filename, { create: true });
        const writable = await (fileHandle as any).createWritable();
        await writable.write(blob);
        await writable.close();
      }

      const descText = brandingNote
        ? draft.description + '\n\nListing drafted with VOWVY — vowvy.com'
        : draft.description;

      const checklist =
        `Listing checklist: ${draft.title}\n` +
        `Created with VOWVY — vowvy.com\n\n` +
        `Steps:\n` +
        `1. Go to Facebook Marketplace and click "Create new listing"\n` +
        `2. Paste the title from listing-title.txt\n` +
        `3. Paste the description from listing-description.txt\n` +
        `4. Click "Add photos" and open this folder — select the photos\n` +
        `5. Review everything carefully before posting\n\n` +
        `VOWVY creates drafts — you post them.\n` +
        `vowvy.com`;

      const textFiles: [string, string][] = [
        ['listing-title.txt',       draft.title],
        ['listing-description.txt', descText],
        ['posting-checklist.txt',   checklist],
      ];

      for (const [filename, content] of textFiles) {
        const fileHandle = await listingDir.getFileHandle(filename, { create: true });
        const writable = await (fileHandle as any).createWritable();
        await writable.write(content);
        await writable.close();
      }

      setFolderName(name);
      setFolderState('done');
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setFolderState('idle');
      } else {
        console.error('[handlePrepareFolder]', err);
        setFolderState('error');
      }
    }
  }

  async function handleChangeLocation() {
    setFolderWarn(false);
    try {
      const dir = await (window as any).showDirectoryPicker({ mode: 'readwrite', startIn: 'downloads' });
      if (looksLikeListingFolder(dir.name)) {
        setFolderWarn(true);
        return;
      }
      savedParentDir = dir;
      setSavedLocationName(dir.name);
      setFolderState('idle');
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        console.error('[handleChangeLocation]', err);
      }
    }
  }

  const platformUrl = selectedPlatform && selectedPlatform !== 'Other'
    ? (PLATFORM_URLS[selectedPlatform] ?? '')
    : '';

  return (
    <div className="sell-overlay" onClick={onClose}>
      <div className="sell-sheet" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <button className="sell-close-btn" onClick={onClose} aria-label={t('sell.done')}>✕</button>

        {/* ── Loading ── */}
        {step === 'loading' && (
          <div className="sell-step sell-step--loading">
            <span className="sell-loading-dot" />
          </div>
        )}

        {/* ── One-time confirmation ── */}
        {step === 'confirm' && (
          <div className="sell-step">
            <h2 className="sell-heading">{t('sell.beforeWeStart')}</h2>
            <p className="sell-body">{t('sell.confirmBody')}</p>
            <button className="sell-primary-btn" onClick={handleConfirm}>
              {t('sell.iUnderstand')}
            </button>
          </div>
        )}

        {/* ── Questions ── */}
        {step === 'questions' && (
          <div className="sell-step">
            <h2 className="sell-heading">{t('sell.heading')}</h2>
            <p className="sell-container-label">{container.name}</p>

            <div className="sell-field">
              <label className="sell-label">{t('sell.describeLabel')}</label>
              <input
                className="sell-input"
                value={itemHint}
                onChange={e => setItemHint(e.target.value)}
                placeholder={t('sell.describePlaceholder')}
                maxLength={60}
                autoFocus
              />
            </div>

            <div className="sell-field">
              <label className="sell-label">{t('sell.whatSelling')}</label>
              {(isFromTray || sourcePhotos) && (
                <p className="sell-body sell-body--small">
                  {t('sell.fromTrayNote')}
                </p>
              )}
              {([ ['whole', t('sell.scopeWhole')],
                  ['one',   t('sell.scopeOne')],
                  ['few',   t('sell.scopeFew')],
              ] as [SellingScope, string][]).map(([val, label]) => (
                <label key={val} className="sell-radio">
                  <input
                    type="radio"
                    name="scope"
                    value={val}
                    checked={sellingScope === val}
                    onChange={() => setSellingScope(val)}
                  />
                  {label}
                </label>
              ))}
            </div>

            <div className="sell-field">
              <label className="sell-label">{t('sell.howSell')}</label>
              {([ ['local',  t('sell.shippingLocal')],
                  ['ship',   t('sell.shippingShip')],
                  ['unsure', t('sell.shippingUnsure')],
              ] as [ShippingIntent, string][]).map(([val, label]) => (
                <label key={val} className="sell-radio">
                  <input
                    type="radio"
                    name="shipping"
                    value={val}
                    checked={shippingIntent === val}
                    onChange={() => setShippingIntent(val)}
                  />
                  {label}
                </label>
              ))}
            </div>

            <div className="sell-field">
              <label className="sell-label">
                {t('sell.anythingToMention')}
                <span className="sell-optional"> {t('sell.optional')}</span>
              </label>
              <textarea
                className="sell-textarea"
                value={userNotes}
                onChange={e => setUserNotes(e.target.value)}
                placeholder={t('sell.conditionPlaceholder')}
                rows={2}
              />
            </div>

            <div className="sell-field">
              <span className="sell-label">{t('sell.photosForListing')}</span>
              <p className="sell-photos-hint">
                {isFromTray
                  ? t('sell.usingSelectedItems')
                  : sourcePhotos
                    ? sourcePhotos.length === 1
                      ? t('sell.usingThisPhoto')
                      : t('sell.usingMatchedPhotos')
                    : t('sell.usingContainerPhotos')}
              </p>
              <div className="sell-photo-thumbs">
                {(sourcePhotos ?? container.photos.filter(p => !p.deletedAt)).map(p => (
                  <div key={p.id} className="sell-photo-thumb">
                    <ThumbImage storagePath={p.storagePath} alt="Listing photo" />
                  </div>
                ))}
              </div>
            </div>

            <button
              className="sell-primary-btn"
              onClick={handleCreateDraft}
              disabled={!itemHint.trim() || saving}
            >
              {saving ? t('sell.creatingDraft') : t('sell.createDraft')}
            </button>
          </div>
        )}

        {/* ── Review ── */}
        {step === 'review' && draft && (
          <div className="sell-step">
            <h2 className="sell-heading">{t('sell.yourDraft')}</h2>
            <p className="sell-body sell-body--small sell-disclaimer">
              {t('sell.reviewDisclaimer')}
            </p>

            <div className="sell-draft-field">
              <span className="sell-draft-label">{t('sell.titleLabel')}</span>
              <p className="sell-draft-value sell-draft-title">{draft.title}</p>
            </div>

            <div className="sell-draft-field">
              <span className="sell-draft-label">{t('sell.descriptionLabel')}</span>
              <p className="sell-draft-value sell-draft-desc">{draft.description}</p>
            </div>

            <div className="sell-draft-field">
              <span className="sell-draft-label">{t('sell.conditionLabel')}</span>
              <p className="sell-draft-value">{draft.condition}</p>
            </div>

            <div className="sell-draft-row">
              <div className="sell-draft-field sell-draft-half">
                <span className="sell-draft-label">{t('sell.categoryLabel')}</span>
                <select
                  className="sell-input"
                  value={editedCategory}
                  onChange={e => setEditedCategory(e.target.value)}
                >
                  {LISTING_CATEGORIES.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="sell-draft-field sell-draft-half">
                <span className="sell-draft-label">{t('sell.suggestedPlatforms')}</span>
                <p className="sell-draft-value">{draft.platforms.join(', ')}</p>
              </div>
            </div>

            <div className="sell-rewrites">
              <span className="sell-rewrites-label">{t('sell.adjustTone')}</span>
              <div className="sell-rewrite-btns">
                {([ ['shorter',      t('sell.toneShorter')],
                    ['friendlier',   t('sell.toneFriendlier')],
                    ['professional', t('sell.toneProfessional')],
                    ['detail',       t('sell.toneDetail')],
                    ['casual',       t('sell.toneCasual')],
                ] as [RewriteMode, string][]).map(([mode, label]) => (
                  <button
                    key={mode}
                    className="sell-rewrite-btn"
                    onClick={() => handleRewrite(mode)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <button
              className="sell-primary-btn"
              onClick={() => setStep('platform')}
            >
              {t('sell.looksGood')}
            </button>
          </div>
        )}

        {/* ── Platform picker ── */}
        {step === 'platform' && (
          <div className="sell-step">
            <h2 className="sell-heading">{t('sell.whereToPost')}</h2>
            <div className="sell-platforms">
              {ALL_PLATFORMS.map(p => (
                <button
                  key={p}
                  className="sell-platform-btn"
                  onClick={() => handleSelectPlatform(p)}
                >
                  {p}
                </button>
              ))}
            </div>
            <button className="sell-back-btn" onClick={() => setStep('review')}>
              {t('sell.backToDraft')}
            </button>
          </div>
        )}

        {/* ── Copy & post ── */}
        {step === 'copy' && draft && (
          <div className="sell-step">
            <h2 className="sell-heading">{t('sell.readyToPost')}</h2>
            {selectedPlatform && selectedPlatform !== 'Other' && (
              <p className="sell-body sell-body--small">
                {t('sell.youChose', { platform: selectedPlatform })}
              </p>
            )}

            <div className="sell-copy-block">
              <div className="sell-copy-row">
                <span className="sell-copy-label">{t('sell.titleLabel')}</span>
                <span className="sell-copy-text">{draft.title}</span>
                <button
                  className="sell-copy-btn"
                  onClick={() => copyText(draft.title, setTitleCopied)}
                >
                  {titleCopied ? t('sell.copied') : t('sell.copyTitle')}
                </button>
              </div>
              <div className="sell-copy-row sell-copy-row--desc">
                <span className="sell-copy-label">{t('sell.descriptionLabel')}</span>
                <span className="sell-copy-text sell-copy-text--desc">{draft.description}</span>
                <button
                  className="sell-copy-btn"
                  onClick={() => copyText(
                    brandingNote
                      ? draft.description + '\n\nListing drafted with VOWVY — vowvy.com'
                      : draft.description,
                    setDescCopied,
                  )}
                >
                  {descCopied ? t('sell.copied') : t('sell.copyDescription')}
                </button>
              </div>
            </div>

            {(() => {
              const photos = (sourcePhotos ?? container.photos.filter(p => !p.deletedAt)).filter(p => !p.deletedAt);
              if (photos.length === 0) return null;
              const titleSlug = slugify(draft.title, 30);
              return (
                <div className="sell-field">
                  <span className="sell-label">{t('sell.photosForYourListing')}</span>

                  {FILE_SYSTEM_ACCESS_SUPPORTED ? (
                    <>
                      {folderState === 'done' ? (
                        <div className="sell-folder-ready">
                          <p className="sell-folder-name">{t('sell.folderCreated')} <strong>{folderName}</strong></p>
                          <p className="sell-folder-instruction">
                            {t('sell.folderInstruction')}
                          </p>
                          <button className="sell-folder-change-btn" onClick={handleChangeLocation}>
                            {t('sell.changeExportFolder')}
                          </button>
                        </div>
                      ) : (
                        <>
                          {savedLocationName ? (
                            <>
                              <p className="sell-folder-hint">
                                {t('sell.saveToLocation', { name: savedLocationName })}
                              </p>
                              <button
                                className="sell-primary-btn"
                                onClick={handlePrepareFolder}
                                disabled={folderState === 'working'}
                              >
                                {folderState === 'working' ? t('sell.creatingFolder') : t('sell.createListingFolder')}
                              </button>
                              <button
                                className="sell-folder-change-btn"
                                onClick={handleChangeLocation}
                                disabled={folderState === 'working'}
                              >
                                {t('sell.changeSaveLocation')}
                              </button>
                            </>
                          ) : (
                            <>
                              <div className="sell-disclaimer">
                                <p className="sell-label">{t('sell.folderSetupTitle')}</p>
                                <ol className="sell-setup-steps">
                                  <li>Click <strong>{t('sell.setExportFolder')}</strong>.</li>
                                  <li>In the window that opens, go to Downloads.</li>
                                  <li>Click <strong>New Folder</strong>.</li>
                                  <li>Name it <strong>VOWVY Exports</strong>.</li>
                                  <li>Select VOWVY Exports.</li>
                                  <li>VOWVY will create the listing folder automatically.</li>
                                </ol>
                              </div>
                              <button
                                className="sell-primary-btn"
                                onClick={handlePrepareFolder}
                                disabled={folderState === 'working'}
                              >
                                {folderState === 'working' ? t('sell.settingLocation') : t('sell.setExportFolder')}
                              </button>
                            </>
                          )}
                        </>
                      )}
                      {folderWarn && (
                        <p className="sell-folder-warn">{t('sell.folderWarn')}</p>
                      )}
                      {folderState === 'error' && (
                        <p className="sell-folder-error">{t('sell.folderError')}</p>
                      )}
                      <p className="sell-fallback-note">{t('sell.downloadIndividually')}</p>
                    </>
                  ) : (
                    <p className="sell-fallback-note">
                      {t('sell.noFolderExport')}
                    </p>
                  )}

                  <div className="sell-download-row">
                    {photos.map((p, i) => (
                      <DownloadPhotoBtn key={p.id} photo={p} index={i} titleSlug={titleSlug} />
                    ))}
                  </div>
                </div>
              );
            })()}

            {platformUrl && (
              <a
                href={platformUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="sell-open-btn"
              >
                {t('sell.openPlatform', { platform: selectedPlatform })}
              </a>
            )}

            <div className="sell-field sell-field--mt">
              <label className="sell-label">
                {t('sell.pasteLinkLabel')}
                <span className="sell-optional"> {t('sell.optional')}</span>
              </label>
              <div className="sell-url-row">
                <input
                  className="sell-input"
                  value={postedUrl}
                  onChange={e => setPostedUrl(e.target.value)}
                  placeholder="https://…"
                  type="url"
                />
                <button
                  className="sell-save-url-btn"
                  onClick={handleSavePostedUrl}
                  disabled={!postedUrl.trim() || urlSaved}
                >
                  {urlSaved ? t('sell.savedUrl') : t('shared.save')}
                </button>
              </div>
            </div>

            <label className="sell-branding-toggle">
              <input
                type="checkbox"
                checked={brandingNote}
                onChange={e => setBrandingNote(e.target.checked)}
              />
              <span>{t('sell.brandingToggle')}</span>
            </label>

            <div className="sell-branding-footer">
              <img src={vowvyLogo} alt="VOWVY" className="sell-branding-logo" />
              <span className="sell-branding-text">Created with VOWVY</span>
              <span className="sell-branding-sep">·</span>
              <a
                href="https://vowvy.com"
                target="_blank"
                rel="noopener noreferrer"
                className="sell-branding-link"
              >vowvy.com</a>
            </div>

            <div className="sell-footer-row">
              <button className="sell-back-btn" onClick={() => setStep('platform')}>
                {t('sell.changePlatform')}
              </button>
              <button className="sell-done-btn" onClick={onClose}>
                {t('sell.done')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
