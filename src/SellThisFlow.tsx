import { useState, useEffect } from 'react';
import { type User } from 'firebase/auth';
import {
  doc, getDoc, setDoc, addDoc, updateDoc, collection, serverTimestamp,
} from 'firebase/firestore';
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

const CATEGORY_KEYWORDS: [string[], string][] = [
  [['lamp', 'light', 'bulb', 'chandelier', 'lantern', 'sconce'],                   'Lighting'],
  [['table', 'chair', 'sofa', 'couch', 'dresser', 'desk', 'shelf', 'bookcase',
    'furniture', 'cabinet', 'wardrobe', 'bench', 'ottoman', 'stool'],               'Furniture'],
  [['bike', 'bicycle', 'scooter', 'skateboard', 'skis', 'sport', 'gym',
    'fitness', 'ball', 'racket', 'tent', 'hiking', 'kayak'],                        'Sports & Outdoors'],
  [['phone', 'laptop', 'computer', 'tablet', 'camera', 'speaker', 'headphone',
    'electronic', 'monitor', 'keyboard', 'remote', 'console', 'printer'],           'Electronics'],
  [['shirt', 'pants', 'coat', 'jacket', 'dress', 'shoes', 'boots', 'clothing',
    'clothes', 'hat', 'bag', 'purse', 'belt', 'scarf', 'gloves'],                  'Clothing & Accessories'],
  [['tool', 'drill', 'wrench', 'saw', 'hammer', 'screwdriver', 'toolbox',
    'level', 'clamp', 'chisel'],                                                    'Tools'],
  [['book', 'novel', 'textbook', 'magazine', 'manual', 'dvd', 'cd', 'vinyl'],      'Books & Media'],
  [['toy', 'game', 'lego', 'doll', 'puzzle', 'kids', 'children', 'board game'],   'Toys & Games'],
  [['pot', 'pan', 'dish', 'plate', 'cup', 'mug', 'kitchen', 'appliance',
    'blender', 'mixer', 'toaster', 'cutlery'],                                      'Kitchen & Dining'],
  [['plant', 'garden', 'outdoor', 'patio', 'lawn', 'flower', 'planter', 'hose'],  'Garden & Outdoor'],
  [['art', 'painting', 'print', 'frame', 'mirror', 'decor', 'vase', 'candle',
    'vintage', 'ceramic', 'figurine', 'rug', 'curtain'],                            'Home Décor'],
  [['stroller', 'crib', 'highchair', 'baby', 'infant', 'toddler'],                 'Baby & Kids'],
];

function guessCategory(itemHint: string, aiTags: string[]): string {
  const text = [itemHint, ...aiTags].join(' ').toLowerCase();
  for (const [keywords, category] of CATEGORY_KEYWORDS) {
    if (keywords.some(k => text.includes(k))) return category;
  }
  return 'General';
}

function guessPlatforms(shippingIntent: ShippingIntent, category: string): string[] {
  const vintageCategories = ['Home Décor', 'Clothing & Accessories', 'Books & Media'];
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

  // AI captions are shown in inventory/lightbox (per-photo aiDescription).
  // Not included in listing copy — avoids image-caption language ("rests on a napkin…").
  // Future workstream: generate a separate buyer-friendly AI summary for listings.
  const aiPart = '';

  const conditionPart = userNotes.trim()
    ? `\n\nCondition notes: ${userNotes.trim()}`
    : '\n\nCondition appears good based on photos. Please review all photos carefully before purchasing.';

  const shippingPart: string =
    shippingIntent === 'local' ? '\n\nLocal pickup only. Cash preferred.' :
    shippingIntent === 'ship'  ? '\n\nWilling to ship — buyer pays actual shipping cost.' :
                                 '\n\nLocal pickup preferred; may consider shipping.';

  const description = scopeIntro + aiPart + conditionPart + shippingPart;
  const condition   = userNotes.trim() || 'See photos for condition details.';
  // Prefer source photo tags for category guessing; fall back to container tags
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
      // Keep scope intro + condition only (2 paragraphs)
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
        ? '' // already included in original draft
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

// Builds a descriptive filename for a listing photo.
// Priority: aiObjects[0] > aiTags[0] > user description > title slug.
// Future: accept a `cleaned?: boolean` param to prefix with "clean-" when
// cleaned listing photos are introduced, so originals and cleaned copies
// stay distinguishable inside the same export folder.
function buildPhotoFilename(photo: PhotoItem, index: number, titleSlug: string): string {
  const prefix = String(index + 1).padStart(2, '0');
  const descriptor =
    photo.aiObjects?.[0] ||
    photo.aiTags?.[0] ||
    photo.description?.trim() ||
    titleSlug;
  const slug = slugify(descriptor || 'photo', 30) || 'photo';
  return `${prefix}-${slug}.jpg`;
}

// File System Access API — Chrome/Edge 88+ only; Firefox and Safari return false.
const FILE_SYSTEM_ACCESS_SUPPORTED =
  typeof window !== 'undefined' && 'showDirectoryPicker' in window;

// Blocks auto-generated listing folders ("VOWVY - Title - YYYY-MM-DD HHmm") to prevent
// nesting. Allows plain parent folders like "VOWVY Exports".
function looksLikeListingFolder(name: string): boolean {
  if (/^VOWVY - .+ - \d{4}-\d{2}-\d{2} \d{4}$/.test(name)) return true;
  const lower = name.toLowerCase();
  return lower.includes('listing') || lower.includes('marketplace');
}

// Parent export directory chosen by the user — persists for the current page session.
// Survives modal close/reopen. Cleared on page refresh.
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
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = buildPhotoFilename(photo, index, titleSlug);
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
  const [step, setStep]                   = useState<Step>('loading');
  const [sellingScope, setSellingScope]   = useState<SellingScope>('whole');
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
  const [folderState, setFolderState]     = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [folderName, setFolderName]       = useState('');
  const [folderWarn, setFolderWarn]       = useState(false);
  const [savedLocationName, setSavedLocationName] = useState<string>(() => savedParentDir?.name ?? '');

  // Check one-time confirmation on mount
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
      // Build folder name: "VOWVY - {title} - YYYY-MM-DD HHmm"
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}${pad(now.getMinutes())}`;
      const titlePart = draft.title.replace(/[^a-zA-Z0-9\s]/g, '').trim().slice(0, 40);
      const name = `VOWVY - ${titlePart} - ${dateStr}`;

      const token = await auth.currentUser?.getIdToken();
      if (!token) { setFolderState('error'); return; }

      // Use saved parent location or prompt the user to pick one.
      let parentDir = savedParentDir;
      if (!parentDir) {
        parentDir = await (window as any).showDirectoryPicker({
          mode: 'readwrite',
          startIn: 'downloads',
        });
        // Guard against nesting inside an existing listing/export folder.
        if (looksLikeListingFolder(parentDir.name)) {
          setFolderState('idle');
          setFolderWarn(true);
          return;
        }
        savedParentDir = parentDir;
        setSavedLocationName(parentDir.name);
      }

      // Create listing subfolder inside the chosen parent.
      // Future "Clean listing photos": swap in a listing-photos/ subdirectory here
      // and write originals to an originals/ subdirectory. The fetch+write loop
      // below is identical regardless of target directory handle.
      const listingDir = await parentDir.getDirectoryHandle(name, { create: true });

      // Determine listing photos.
      // Future: replace exportPhotos with cleaned versions when that feature ships.
      // The write loop below does not need to change — only this array changes.
      const exportPhotos = (sourcePhotos ?? container.photos.filter(p => !p.deletedAt))
        .filter(p => !p.deletedAt);
      const titleSlug = slugify(draft.title, 30);

      // Write photo files
      for (let i = 0; i < exportPhotos.length; i++) {
        const photo = exportPhotos[i];
        const filename = buildPhotoFilename(photo, i, titleSlug);
        const proxyUrl = `${PROXY_BASE}?path=${encodeURIComponent(photo.storagePath)}`;
        const res = await fetch(proxyUrl, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) continue;
        const blob = await res.blob();
        const fileHandle = await listingDir.getFileHandle(filename, { create: true });
        const writable = await (fileHandle as any).createWritable();
        await writable.write(blob);
        await writable.close();
      }

      // Write text files
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
      // AbortError = user cancelled the picker dialog — go back to idle
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
        <button className="sell-close-btn" onClick={onClose} aria-label="Close">✕</button>

        {/* ── Loading ── */}
        {step === 'loading' && (
          <div className="sell-step sell-step--loading">
            <span className="sell-loading-dot" />
          </div>
        )}

        {/* ── One-time confirmation ── */}
        {step === 'confirm' && (
          <div className="sell-step">
            <h2 className="sell-heading">Before we start</h2>
            <p className="sell-body">
              Before creating listings, please confirm: You are responsible for making
              sure you own this item, it can legally be sold, and your listing is
              accurate. VOWVY creates drafts — you post them.
            </p>
            <button className="sell-primary-btn" onClick={handleConfirm}>
              I understand
            </button>
          </div>
        )}

        {/* ── Questions ── */}
        {step === 'questions' && (
          <div className="sell-step">
            <h2 className="sell-heading">Sell this</h2>
            <p className="sell-container-label">{container.name}</p>

            <div className="sell-field">
              <label className="sell-label">
                Describe it in a few words
              </label>
              <input
                className="sell-input"
                value={itemHint}
                onChange={e => setItemHint(e.target.value)}
                placeholder="blue ceramic lamp"
                maxLength={60}
                autoFocus
              />
            </div>

            <div className="sell-field">
              <label className="sell-label">What are you selling?</label>
              {([ ['whole', 'The whole container'],
                  ['one',   'Just one item in these photos'],
                  ['few',   "A few items — I'll describe them"],
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
              <label className="sell-label">How do you want to sell it?</label>
              {([ ['local',  'Local pickup only'],
                  ['ship',   'I can ship it'],
                  ['unsure', 'Not sure yet'],
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
                Anything important to mention?
                <span className="sell-optional"> optional</span>
              </label>
              <textarea
                className="sell-textarea"
                value={userNotes}
                onChange={e => setUserNotes(e.target.value)}
                placeholder="small scratch on top, missing remote, works great…"
                rows={2}
              />
            </div>

            <div className="sell-field">
              <span className="sell-label">Photos for this listing</span>
              <p className="sell-photos-hint">
                {isFromTray
                  ? 'Using selected items'
                  : sourcePhotos
                    ? sourcePhotos.length === 1
                      ? 'Using this photo'
                      : 'Using photos that matched your search'
                    : 'Using photos from this container'}
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
              {saving ? 'Creating draft…' : 'Create my draft'}
            </button>
          </div>
        )}

        {/* ── Review ── */}
        {step === 'review' && draft && (
          <div className="sell-step">
            <h2 className="sell-heading">Your draft</h2>
            <p className="sell-body sell-body--small sell-disclaimer">
              This is a starting point — review it before posting.
              VOWVY does not verify ownership, condition, value, or marketplace acceptance.
            </p>

            <div className="sell-draft-field">
              <span className="sell-draft-label">Title</span>
              <p className="sell-draft-value sell-draft-title">{draft.title}</p>
            </div>

            <div className="sell-draft-field">
              <span className="sell-draft-label">Description</span>
              <p className="sell-draft-value sell-draft-desc">{draft.description}</p>
            </div>

            <div className="sell-draft-field">
              <span className="sell-draft-label">Condition</span>
              <p className="sell-draft-value">{draft.condition}</p>
            </div>

            <div className="sell-draft-row">
              <div className="sell-draft-field sell-draft-half">
                <span className="sell-draft-label">Category</span>
                <p className="sell-draft-value">{draft.category}</p>
              </div>
              <div className="sell-draft-field sell-draft-half">
                <span className="sell-draft-label">Suggested platforms</span>
                <p className="sell-draft-value">{draft.platforms.join(', ')}</p>
              </div>
            </div>

            <div className="sell-rewrites">
              <span className="sell-rewrites-label">Adjust tone</span>
              <div className="sell-rewrite-btns">
                {([ ['shorter',      'Make it shorter'],
                    ['friendlier',   'Make it friendlier'],
                    ['professional', 'More professional'],
                    ['detail',       'Add more detail'],
                    ['casual',       'More casual'],
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
              Looks good — choose where to post
            </button>
          </div>
        )}

        {/* ── Platform picker ── */}
        {step === 'platform' && (
          <div className="sell-step">
            <h2 className="sell-heading">Where do you want to post this?</h2>
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
              ← Back to draft
            </button>
          </div>
        )}

        {/* ── Copy & post ── */}
        {step === 'copy' && draft && (
          <div className="sell-step">
            <h2 className="sell-heading">Ready to post</h2>
            {selectedPlatform && selectedPlatform !== 'Other' && (
              <p className="sell-body sell-body--small">
                You chose <strong>{selectedPlatform}</strong>.
                Copy the title and description, open the platform, and paste.
              </p>
            )}

            <div className="sell-copy-block">
              <div className="sell-copy-row">
                <span className="sell-copy-label">Title</span>
                <span className="sell-copy-text">{draft.title}</span>
                <button
                  className="sell-copy-btn"
                  onClick={() => copyText(draft.title, setTitleCopied)}
                >
                  {titleCopied ? '✓ Copied' : 'Copy title'}
                </button>
              </div>
              <div className="sell-copy-row sell-copy-row--desc">
                <span className="sell-copy-label">Description</span>
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
                  {descCopied ? '✓ Copied' : 'Copy description'}
                </button>
              </div>
            </div>

            {(() => {
              const photos = (sourcePhotos ?? container.photos.filter(p => !p.deletedAt)).filter(p => !p.deletedAt);
              if (photos.length === 0) return null;
              const titleSlug = slugify(draft.title, 30);
              return (
                <div className="sell-field">
                  <span className="sell-label">Photos for your listing</span>

                  {FILE_SYSTEM_ACCESS_SUPPORTED ? (
                    <>
                      {folderState === 'done' ? (
                        <div className="sell-folder-ready">
                          <p className="sell-folder-name">VOWVY created this folder: <strong>{folderName}</strong></p>
                          <p className="sell-folder-instruction">
                            Use this folder when Facebook asks you to add photos.
                          </p>
                          <button className="sell-folder-change-btn" onClick={handleChangeLocation}>
                            Change VOWVY export folder
                          </button>
                        </div>
                      ) : (
                        <>
                          {savedLocationName ? (
                            <>
                              <p className="sell-folder-hint">
                                VOWVY will save to: <strong>{savedLocationName}</strong>. Click <strong>Create listing folder</strong> and VOWVY will create a named folder automatically.
                              </p>
                              <button
                                className="sell-primary-btn"
                                onClick={handlePrepareFolder}
                                disabled={folderState === 'working'}
                              >
                                {folderState === 'working' ? 'Creating folder…' : 'Create listing folder'}
                              </button>
                              <button
                                className="sell-folder-change-btn"
                                onClick={handleChangeLocation}
                                disabled={folderState === 'working'}
                              >
                                Change save location
                              </button>
                            </>
                          ) : (
                            <>
                              <div className="sell-disclaimer">
                                <p className="sell-label">First-time setup</p>
                                <ol className="sell-setup-steps">
                                  <li>Click <strong>Set VOWVY export folder</strong>.</li>
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
                                {folderState === 'working' ? 'Setting location…' : 'Set VOWVY export folder'}
                              </button>
                            </>
                          )}
                        </>
                      )}
                      {folderWarn && (
                        <p className="sell-folder-warn">
                          Choose a plain parent folder like "VOWVY Exports" — not an auto-generated listing folder.
                        </p>
                      )}
                      {folderState === 'error' && (
                        <p className="sell-folder-error">Something went wrong. Try again or download photos below.</p>
                      )}
                      <p className="sell-fallback-note">Or download individually:</p>
                    </>
                  ) : (
                    <p className="sell-fallback-note">
                      This browser doesn't support folder export. Download the photos below with listing-ready filenames.
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
                Open {selectedPlatform} ↗
              </a>
            )}

            <div className="sell-field sell-field--mt">
              <label className="sell-label">
                Paste your listing link here
                <span className="sell-optional"> optional</span>
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
                  {urlSaved ? 'Saved ✓' : 'Save'}
                </button>
              </div>
            </div>

            <label className="sell-branding-toggle">
              <input
                type="checkbox"
                checked={brandingNote}
                onChange={e => setBrandingNote(e.target.checked)}
              />
              <span>Add 'Created with VOWVY' note to description</span>
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
                ← Change platform
              </button>
              <button className="sell-done-btn" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
