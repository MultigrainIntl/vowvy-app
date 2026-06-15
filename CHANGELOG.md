# VOWVY Changelog

Newest first. Plain English: what changed and why it matters.

## June 14, 2026 — Internationalization Phase 1 (pre-login screens)

### Multilingual first-time/signed-out experience (commit 5f2a77d)

- **AuthScreen** fully translated: welcome landing page (headline, subheadline, 4-step how-it-works, 7 benefits, 6 audience rows, closing CTA), sign-up form, and sign-in form. Language selector (`<select>`) added to all three views — positioned in a top bar on the landing page and right-aligned inside the card on sign-up/sign-in.
- **PolicyAcceptanceScreen** translated: intro, three policy link labels, agree button, and sign-out link.
- **OnboardingScreen** fully translated: category cards (9 types), all question screens (home setup, moving setup, storage setup, collection setup), space/storage checkbox names, size cards, steppers, back/preview/create buttons, and error text. Space names are written to Firestore in the user's chosen language.
- **Locale files** (EN / ES / PT-BR): 124 new keys added per file across `auth.landing`, `auth.signup`, `auth.signin`, `policy`, and `onboarding` sections. All three files are structurally identical at 263 keys total.
- **Language selector**: canonical values `en` / `es` / `pt-BR`; reads and writes `localStorage["vowvy-lang"]`; `pt` and `pt-BR` both resolve to Portuguese. Language choice persists across page refreshes.
- **CSS** (`App.css`): `.auth-lang-bar`, `.auth-lang-row`, `.auth-lang-select` added for language selector placement in auth views. No visual redesign to any other element.
- **Post-login screens** (MainScreen, ManageScreen, ProfileScreen, etc.) not changed — Phase 2.

---

## June 13–14, 2026 — Policy, AI, Search, Sell This, and Items to sell

### Lightbox UI cleanup (commit 4c14467, merged c01826d)

- Privacy dropdown in lightbox now uses plain-English labels: "Follow parent / Hide from helpers / Show to helpers" instead of "Inherit / Private / Shared". Firestore values are unchanged.
- Status text now reflects visibility setting precisely: e.g. "Following parent — helpers can see this" vs "Following parent — helpers cannot see this" depending on effectiveIsPrivate.
- "Sell this photo" button removed from lightbox. Single selling entry point from photos is now "Add to Items to sell" → tray → Create listing draft.

### Items to sell tray (commit 737a48c, merged 46cd1d8)

- "Add to Items to sell" button added to lightbox (owner only). Toggles to "Added ✓" when photo is already in tray.
- "Items to sell (N)" indicator in app header when tray has items; hidden when empty.
- "Sell" button added next to search bar; shows count when tray has items.
- Tray panel: bottom-sheet overlay showing selected photos with container name, Remove per item, Clear all, Create listing draft.
- Multi-container support: photos from different containers produce a synthetic container shell; listing stored with containerId: null and sourceContainerIds[] array.
- Copy/Ready to Post step now includes per-photo download buttons (fetch-blob via proxyImage) so photos can be saved before posting.

### Search-matched thumbnails and listing flow (commit 5f07636, merged 062b6ef)

- Container cards now show the newest search-matched photo as thumbnail when search is active, rather than the default latest photo.
- Terracotta "N matches" badge on thumbnail when search is filtering photos.
- "Add to Items to sell" (then tray) and "Sell this" card button both pass matched photos as source photos into the listing draft flow.
- Listing draft "Photos for this listing" thumbnail strip shows the actual source photos being used.

### Search photo listing context (commit 0c278fa, merged db87c37)

- Lightbox opened from a search result now shows only matching photos (newest-first) with a filter banner.
- "Show all photos" button in banner reveals the full photo set.
- "Sell this photo" (now removed) and "Add to Items to sell" from lightbox correctly pass the individual photo as the sole source photo into the listing draft.

### Search/tag cleanup (commit 2e8c9d3, merged d5ddcd8)

- AI keyword chips removed from main container cards entirely — cards were cluttered and tags were often generic.
- Search now includes photo-level aiDescription, aiTags, and aiObjects in addition to container-level fields and notes.
- photoMatchMap computed per render: per-container list of photos that matched the query.
- Generic display tags (art, graphics, decorations, logistics, etc.) suppressed from lightbox display when more specific tags exist. filterDisplayTags() helper handles this client-side without touching stored data.

### Photo-level AI analysis (commit 4eb4379)

- PhotoItem now stores per-photo AI fields: aiDescription, aiTags, aiObjects, aiStatus.
- analyzeContainerPhoto Cloud Function (onDocumentWritten) now identifies the newly added photo by ID comparison and patches only that photo's entry in photos[]. Previously it overwrote container-root AI fields on every photo addition, losing the first photo's analysis.
- Re-reads the document before writing to prevent concurrent-upload conflicts.
- Container-level aiTags and aiSearchTerms are merged across all non-deleted photos.
- Lightbox in MainScreen and ContainerScreen displays the selected photo's own AI description and tags.

### VOWVY branding in Sell This (commit a59f791)

- Ready to Post screen shows a small VOWVY branding footer: logo mark, "Created with VOWVY", vowvy.com link.
- Optional checkbox "Add 'Created with VOWVY' note to description" — defaults off. When on, appends the note to clipboard copy only; stored draft text is unchanged.

### Sell This — listing draft MVP (commit 0f90d2d, merged 663696e)

- "Sell this" button added to container action row (owner only).
- One-time listing responsibility confirmation screen (stored in users/{uid} as listingConfirmationAcceptedAt).
- Questions step: describe the item, what you're selling (whole / one / a few), shipping intent, optional condition notes.
- Draft built from user input + container/photo AI data. No external pricing or AI calls.
- Draft stored at users/{uid}/listings/{listingId} with title, description, condition, category, suggested platforms.
- Review step: view draft, adjust tone (shorter / friendlier / professional / more detail / casual) with rule-based rewrites.
- Platform picker: Facebook Marketplace, Craigslist, Etsy, eBay, Other.
- Copy title / copy description buttons. Manual posting only — no marketplace API or auto-fill.
- Optional: paste listing URL back to save it against the draft.

### Container action button wrapping fix (commit 3658fbb, merged ad762b4)

- Container action buttons (Add photo, Take photos, Print QR, Move, Sell this) now wrap correctly after Sell this was added. No overlap with the right-side upload panel.

### Policy acceptance, legal pages, and photo moderation metadata (commit 7cf965a, merged 429464d)

- /privacy, /terms, /acceptable-use pages added and linked from the auth screen.
- New users must check a policy acknowledgement box before signing up.
- Existing users who signed up before the policy gate see a one-time acceptance screen on their next login; dismissed permanently after accepting.
- All new photo uploads now include moderation metadata fields: moderationStatus ("pending"), moderationCheckedAt, moderationProvider, moderationReason. Field structure ready for a future automated moderation step.

---

## June 13, 2026 — Internationalization Phase 1A + Privacy Phase 1A & 1B

### Internationalization Phase 1A (commit f1b9389, merged 5a1c601)

- Added `react-i18next` with lazy-loaded translation files for English, Spanish, and Brazilian Portuguese.
- All UI strings in AuthScreen, MainScreen, and shared components now use translation keys.
- Language switcher in the mobile menu (EN / ES / PT-BR). Language preference saved to localStorage.
- 139 matching keys across all three locale files.

### Privacy Phase 1A (commit 670b96b, merged 736f6a4)

- Added `isPrivate: boolean` field to all containers (defaulting to false on all new creates).
- Collaborator Firestore query filters out `isPrivate: true` containers.
- Firestore rules: collaborators cannot read private containers or their subcollections.
- `proxyImage` Cloud Function: returns 403 if collaborator requests a photo from a private container.
- `uploadCollaboratorPhoto` Cloud Function: rejects uploads to private containers.
- Added Firestore composite index: `isPrivate ASC + createdAt DESC`.
- Backfill: temporary `backfillIsPrivateOnce` admin-only Cloud Function + Admin screen panel used to set `isPrivate: false` on all pre-existing containers (confirmed complete).

### Privacy Phase 1B — Full hierarchy privacy (commits below, all on main as of June 13, 2026)

**Step 1 — Lightbox proxy (daa310f, merged 7c77e7a)**
- Added `LightboxImage` component to `src/shared.tsx` using the same `proxyImage` auth-token fetch pattern as `ThumbImage`.
- Replaced raw `<img src={item.url}>` in the MainScreen lightbox with `<LightboxImage storagePath={item.storagePath}>`.
- All photo display in the app now routes through `proxyImage`. No raw Firebase Storage download token URLs rendered in the UI.

**Step 2 & 3 — Visibility/effectiveIsPrivate backfill (0a79e0d, merged d2a7179)**
- Added temporary `backfillLocationsVisibility` and `backfillContainersVisibility` admin-only Cloud Functions.
- Added two Admin screen panels for dry-run and write modes.
- Backfill completed: all location documents now have `visibility: "inherit"` and `effectiveIsPrivate: false`. All container documents now have `visibility` (derived from `isPrivate`) and `effectiveIsPrivate`.

**Step 4 — Enforcement switches to effectiveIsPrivate (3185096, merged 57b37c1)**
- `proxyImage` and `uploadCollaboratorPhoto` Cloud Functions now check `effectiveIsPrivate` instead of `isPrivate`.
- Firestore rules updated: container read/write and subcollection rules check `effectiveIsPrivate != true`; location collaborator read rule checks `effectiveIsPrivate != true`.
- Firestore index added: `effectiveIsPrivate ASC + createdAt DESC`.
- MainScreen: collaborator query uses `where('effectiveIsPrivate', '==', false)`; client-side filter uses `effectiveIsPrivate`; `Container` interface and `mapContainer` include `effectiveIsPrivate` (with `isPrivate` fallback).

**Step 5 — Location privacy toggle and inheritance (ac05ac2, merged 0bc7697)**
- `Location` interface now includes `visibility: "inherit" | "private" | "shared"` and `effectiveIsPrivate: boolean`.
- `createLocation` writes these fields on all new locations.
- `subscribeToLocations` maps them with safe defaults.
- ManageScreen: `applyLocationVisibility` function BFS-propagates privacy changes through descendant locations and containers (batch writes, chunks of 400).
- ManageScreen: privacy `<select>` (Inherit / Private / Shared) added to each location row with confirm dialog.
- MainScreen lock button: writes `visibility` + `effectiveIsPrivate` + `isPrivate`; visual state uses `effectiveIsPrivate`; all new container create paths write `visibility: "inherit"` and `effectiveIsPrivate` derived from the target location.

**Privacy controls UI pass (90ce606, merged a9af39d)**
- ManageScreen: location rows restructured — main actions (Rename / Move / Delete) on top row; privacy control (🔒/🔓 icon + "Privacy" label + Inherit/Private/Shared select) and add-buttons (+ Sub-location / + Container) on a dedicated sub-row below. Private locations tinted amber.
- MainScreen container cards: lock icon now uses 🔒/🔓, `container-lock-btn` CSS class with 32px min touch target, hover state, `aria-label`.
- Lightbox: "Container privacy" panel added below photo description (owner-only). Shows current visibility, Inherit/Private/Shared select, and "Hidden from / Visible to collaborators" status. Clearly scoped to the container, not individual photos.
- Collaborators screen: privacy note added — "Private locations and containers are hidden from collaborators. A shared item stays visible even inside a private area."
- Individual photo privacy was **intentionally not implemented** (future work).

---

## June 12, 2026

- Full-system audit documents added (19 files) under Agent Team OS Issue #1: repo audit, project state, product/landing/mobile/Firebase/security/data-model reviews, analytics/SEO/GTM plans, business plan, revenue canvas, exit readiness, app build path, resource budget, next steps, repo-operator instructions, and this changelog. No app code was changed; nothing was deployed.
- Key findings: this repo is a stale snapshot of the live app (sync recommended as first implementation issue); zero analytics anywhere; reCAPTCHA secret previously exposed in the public website repo was redacted there (commit 0a35a57) and rotation is recorded as an open security task; strong product philosophy and owner monetization thinking confirmed.
- Roadmap ideas captured: Junk Drawer multi-object capture, Image Quality Gate, Marketplace Quality Gate, quality-gated marketplace exports and future publishing, subtle listing branding, resale comps support, moving-company contributor workflow, structured AI output spec.

## Prior to June 12, 2026

- See git history: initial MVP (email auth, photo + location + name capture, grouped list, client-side compression) and iOS Chrome photo-picker workarounds. The live app advanced beyond this repo via local development; that history lives outside GitHub until the code sync lands.
