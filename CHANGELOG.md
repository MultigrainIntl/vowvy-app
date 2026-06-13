# VOWVY Changelog

Newest first. Plain English: what changed and why it matters.

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

### Latest main commits as of June 13, 2026

```
a9af39d Merge feature/privacy-controls-ui-pass into main
90ce606 Improve privacy controls UI
0bc7697 Merge feature/privacy-phase-1b-location-toggle into main
ac05ac2 Add location privacy inheritance controls
57b37c1 Merge feature/privacy-phase-1b-effective-enforcement into main
3185096 Switch privacy enforcement to effective privacy
d2a7179 Merge feature/privacy-phase-1b-visibility-backfill into main
0a79e0d Add visibility backfill tooling for locations and containers
7c77e7a Merge feature/privacy-phase-1b-lightbox-proxy into main
daa310f Route lightbox photos through proxy
```

## June 12, 2026

- Full-system audit documents added (19 files) under Agent Team OS Issue #1: repo audit, project state, product/landing/mobile/Firebase/security/data-model reviews, analytics/SEO/GTM plans, business plan, revenue canvas, exit readiness, app build path, resource budget, next steps, repo-operator instructions, and this changelog. No app code was changed; nothing was deployed.
- Key findings: this repo is a stale snapshot of the live app (sync recommended as first implementation issue); zero analytics anywhere; reCAPTCHA secret previously exposed in the public website repo was redacted there (commit 0a35a57) and rotation is recorded as an open security task; strong product philosophy and owner monetization thinking confirmed.
- Roadmap ideas captured: Junk Drawer multi-object capture, Image Quality Gate, Marketplace Quality Gate, quality-gated marketplace exports and future publishing, subtle listing branding, resale comps support, moving-company contributor workflow, structured AI output spec.

## Prior to June 12, 2026

- See git history: initial MVP (email auth, photo + location + name capture, grouped list, client-side compression) and iOS Chrome photo-picker workarounds. The live app advanced beyond this repo via local development; that history lives outside GitHub until the code sync lands.
