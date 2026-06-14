# VOWVY Project State

Last updated: June 14, 2026. Repo is current with the live deployed app.

## What VOWVY is

A searchable memory system for physical possessions. Photograph a box or container, AI catalogs what is inside, and you can find anything later by searching. Philosophy: Capture first. Organize later.

## Status

- Stage: Active (live MVP with real functionality)
- Live app: https://app.vowvy.com (backup: https://vowvy-1ba5f.web.app)
- Marketing site: https://multigrainintl.github.io/vowvy-website/ (custom domain www.vowvy.com not yet pointed via DNS)
- App repo: this repo — **current with production** as of June 14, 2026
- Website repo: MultigrainIntl/vowvy-website
- Firebase project: vowvy-1ba5f
- Latest main commit: c01826d (Merge lightbox UI cleanup into main)

## What works today

- Google sign-in with custom auth domain, sessions persist
- Password reset
- Locations, containers, photo capture and upload
- AI tags and descriptions via Gemini 2.5 Flash
  - AI analysis is now per-photo: each PhotoItem stores its own aiDescription, aiTags, aiObjects, aiStatus
  - Container-level aiTags and aiSearchTerms are merged across all non-deleted photos
  - Lightbox displays the selected photo's own AI description and tags
  - Generic/clutter tags filtered from display without changing stored data
- Full-text search across names, locations, tags, descriptions, notes, and photo-level AI fields
  - Search matches inside aiDescription, aiTags, aiObjects per photo
  - Matched containers show the newest matching photo as thumbnail, with a count badge
  - Lightbox can show only matching photos when search is active; "Show all photos" escape hatch
- QR code per container with deep links and printable labels
- Soft-delete trash with 30-day retention
- Collaborator invite and access flow (invite link, accept screen, collaborator dashboard)
- Collaborators can add photos, edit descriptions, view owner inventory
- iPad and iOS Safari compatibility workarounds
- UI in English, Spanish, and Brazilian Portuguese (i18n Phase 1A)
- Container-level privacy controls:
  - Locations: Follow parent / Hide from helpers / Show to helpers visibility (stored as inherit/private/shared)
  - Containers: inherit from location, or explicitly private or shared
  - effectiveIsPrivate denormalized field for efficient Firestore queries and rules
  - Firestore rules, Cloud Functions (proxyImage, uploadCollaboratorPhoto), and client queries all enforce effectiveIsPrivate
  - All photos served through proxyImage (no raw Firebase Storage URLs in UI)
  - Privacy controls visible in: Manage Locations sub-row, container card lock icon, lightbox Container privacy panel, Collaborators screen note
- Policy and legal pages:
  - /privacy, /terms, /acceptable-use pages live
  - New-user policy checkbox at signup
  - Existing-user one-time policy acceptance gate (shown once on next login, then dismissed)
  - Photo moderation metadata (moderationStatus, moderationCheckedAt, moderationProvider, moderationReason) added to all new uploads
- Sell This — listing draft MVP:
  - "Sell this" button on container cards (owner only)
  - One-time listing responsibility confirmation
  - Listing draft flow: item name, scope, shipping intent, condition notes
  - Draft stored in users/{uid}/listings/{listingId}
  - Copy title / copy description for manual posting
  - Platform selection (Facebook Marketplace, Craigslist, Etsy, eBay, Other)
  - Manual posting only — no marketplace API or auto-fill
  - Subtle VOWVY branding on Ready to Post screen; optional "Listing drafted with VOWVY" note (defaults off)
  - No pricing or comparables
- Items to sell tray:
  - "Add to Items to sell" button in lightbox (owner only); toggles to "Added ✓"
  - "Items to sell (N)" indicator in header when tray has items
  - "Sell" button in search row opens tray
  - Tray panel: thumbnails, container name, Remove per item, Clear all, Create listing draft
  - Multi-container support: photos from different containers create a synthetic container shell; containerId: null + sourceContainerIds[] written to listing
  - Copy step includes per-photo download buttons (fetch-blob via proxy)

## What is broken or missing

- App Check disabled; reCAPTCHA secret was exposed and needs rotation (see SECURITY_REVIEW.md)
- Zero analytics anywhere
- www.vowvy.com DNS not connected; OG image and favicons missing on landing page
- Email notifications broken (SMTP 401, parked)
- Ghost AI tags at container level may persist for old containers after photo deletion — per-photo AI addresses this for new data; old container-root data cleanup not done
- Temporary backfill admin panels and Cloud Functions remain (backfillIsPrivateOnce, backfillLocationsVisibility, backfillContainersVisibility) — safe to remove after confidence period
- Old isPrivate field and manual isPrivate Firestore index remain — cleanup after full effectiveIsPrivate confidence period
- Individual photo privacy not implemented (intentional, future work)
- Per-collaborator permissions not implemented (future work)
- Node.js 20 runtime deprecation warning on Cloud Functions (deprecates October 2026)
- Image transfer from app to marketplace is manual; download UX in Ready to Post step is minimal
- No comparable pricing or resale value lookup

## Current focus

- Items to sell tray and listing draft MVP are live — needs manual end-to-end testing
- Policy acceptance gates are live — needs manual testing as new user and returning user
- Ready to Post image-transfer UX may need improvement (clearer instructions, bulk download)

## Out of scope right now

- Marketplace APIs, pricing/comparables, PWA, B2B pilot (captured in PRODUCT_REVIEW.md and NEXT_STEPS.md)
