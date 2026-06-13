# VOWVY Project State

Last updated: June 13, 2026. Repo is current with the live deployed app.

## What VOWVY is

A searchable memory system for physical possessions. Photograph a box or container, AI catalogs what is inside, and you can find anything later by searching. Philosophy: Capture first. Organize later.

## Status

- Stage: Active (live MVP with real functionality)
- Live app: https://app.vowvy.com (backup: https://vowvy-1ba5f.web.app)
- Marketing site: https://multigrainintl.github.io/vowvy-website/ (custom domain www.vowvy.com not yet pointed via DNS)
- App repo: this repo — **current with production** as of June 13, 2026
- Website repo: MultigrainIntl/vowvy-website
- Firebase project: vowvy-1ba5f
- Latest main commit: a9af39d (Merge feature/privacy-controls-ui-pass into main)

## What works today

- Google sign-in with custom auth domain, sessions persist
- Password reset
- Locations, containers, photo capture and upload
- AI tags and descriptions via Gemini 2.5 Flash
- Full-text search across names, locations, tags, descriptions, notes
- QR code per container with deep links and printable labels
- Soft-delete trash with 30-day retention
- Collaborator invite and access flow (invite link, accept screen, collaborator dashboard)
- Collaborators can add photos, edit descriptions, view owner inventory
- iPad and iOS Safari compatibility workarounds
- UI in English, Spanish, and Brazilian Portuguese (i18n Phase 1A)
- Container-level privacy controls:
  - Locations: Inherit / Private / Shared visibility
  - Containers: inherit from location, or explicitly Private / Shared
  - effectiveIsPrivate denormalized field for efficient Firestore queries and rules
  - Firestore rules, Cloud Functions (proxyImage, uploadCollaboratorPhoto), and client queries all enforce effectiveIsPrivate
  - All photos served through proxyImage (no raw Firebase Storage URLs in UI)
  - Privacy controls visible in: Manage Locations sub-row, container card lock icon, lightbox Container privacy panel, Collaborators screen note

## What is broken or missing

- App Check disabled; reCAPTCHA secret was exposed and needs rotation (see SECURITY_REVIEW.md)
- Zero analytics anywhere
- www.vowvy.com DNS not connected; OG image and favicons missing on landing page
- Email notifications broken (SMTP 401, parked)
- Ghost AI tags persist after photo deletion (data model issue — tags belong to photos, not containers)
- Temporary backfill admin panels and Cloud Functions remain (backfillIsPrivateOnce, backfillLocationsVisibility, backfillContainersVisibility) — safe to remove after confidence period
- Old isPrivate field and manual isPrivate Firestore index remain — cleanup after full effectiveIsPrivate confidence period
- Individual photo privacy not implemented (intentional, future work)
- Per-collaborator permissions not implemented (future work)
- Node.js 20 runtime deprecation warning on Cloud Functions (deprecates October 2026)

## Current focus

- Privacy Phase 1B complete and deployed
- Next: live test privacy controls as owner and collaborator, then new-user setup questionnaire

## Out of scope right now

- Marketplace track, PWA, B2B pilot (captured in PRODUCT_REVIEW.md and NEXT_STEPS.md)
