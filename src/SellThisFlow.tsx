import { useState, useEffect } from 'react';
import { type User } from 'firebase/auth';
import {
  doc, getDoc, setDoc, addDoc, updateDoc, collection, serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import type { PhotoItem } from './shared';
import vowvyLogo from './assets/logo-mark.svg';
import './SellThisFlow.css';

// ---- Types ----------------------------------------------------------------

type SellingScope   = 'whole' | 'one' | 'few';
type ShippingIntent = 'local' | 'ship' | 'unsure';
type Step = 'loading' | 'confirm' | 'questions' | 'review' | 'platform' | 'copy';
type RewriteMode = 'shorter' | 'friendlier' | 'professional' | 'detail' | 'casual';

interface ContainerForListing {
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
): Draft {
  const title = capitalize(itemHint.trim());

  const scopeIntro: string =
    sellingScope === 'whole' ? `${title} — everything shown in the photos.` :
    sellingScope === 'one'   ? `${title}. One item, pictured.` :
                               `${title}. A few items — see photos for details.`;

  const aiPart = container.aiDescription?.trim()
    ? `\n\n${container.aiDescription.trim()}`
    : '';

  const conditionPart = userNotes.trim()
    ? `\n\nCondition notes: ${userNotes.trim()}`
    : '\n\nCondition appears good based on photos. Please review all photos carefully before purchasing.';

  const shippingPart: string =
    shippingIntent === 'local' ? '\n\nLocal pickup only. Cash preferred.' :
    shippingIntent === 'ship'  ? '\n\nWilling to ship — buyer pays actual shipping cost.' :
                                 '\n\nLocal pickup preferred; may consider shipping.';

  const description = scopeIntro + aiPart + conditionPart + shippingPart;
  const condition   = userNotes.trim() || 'See photos for condition details.';
  const category    = guessCategory(itemHint, container.aiTags);
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

// ---- Component ------------------------------------------------------------

export default function SellThisFlow({ user, container, onClose }: Props) {
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
  const [brandingNote, setBrandingNote]   = useState(false);

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
      const d = buildDraft(container, sellingScope, itemHint, shippingIntent, userNotes);
      const photoIds = container.photos
        .filter(p => !p.deletedAt)
        .map(p => p.id);

      const ref = await addDoc(
        collection(db, `users/${user.uid}/listings`),
        {
          containerId:          container.id,
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
