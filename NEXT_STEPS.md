# VOWVY Next Steps

Prioritized. Each item should become a GitHub issue before work starts. Long-term ideas live in PRODUCT_REVIEW.md and the agent-team-os idea backlog, not here.

## Immediate (test what just shipped)

1. **Manual live testing — Items to sell end-to-end**: Open the app, add photos to the tray from different containers, open the tray, create a listing draft, go through all steps, reach Ready to Post, download a photo. Verify multi-container path (containerId: null + sourceContainerIds in Firestore). Verify single-container path is unchanged.
2. **Manual live testing — policy acceptance gates**: Sign in with a fresh account and confirm the policy checkbox appears. Sign in with an existing account that has not yet seen the gate and confirm the one-time gate appears. Confirm it does not appear again on next login.
3. **Improve Ready to Post image-transfer UX if needed**: Based on live testing, decide whether to add:
   - "Download photo" button per photo (fetch-blob, already wired)
   - "Download all photos" batch action
   - Clearer manual upload instructions for each platform

## Up next (in order)

4. **Comparable pricing / search** — only if pursued: use careful, disclaimer-wrapped wording; no appraisal claims; no "your item is worth X" language. Likely: "similar items sold for" with source attribution.
5. **Official marketplace integrations** — only through approved APIs and account-linking (Etsy Partner API, eBay Developers Program). No scraping, no auto-fill, no unapproved automation.
6. **i18n / language cleanup** — defer until English UI stabilizes. Current Spanish and PT-BR strings will need a pass once Sell This and Items to sell labels settle.

## Standing cleanup (carry forward)

7. **Remove temporary backfill tooling** once privacy data confirmed correct. Remove: `backfillIsPrivateOnce`, `backfillLocationsVisibility`, `backfillContainersVisibility` from `functions/src/index.ts`; remove the three Admin screen panels from `src/AdminScreen.tsx`. Deploy functions + hosting.
8. **Deprecate old isPrivate field**: stop writing `isPrivate` on all new container creates; update Firestore rules to drop the `isPrivate` fallback; remove the manual `isPrivate ASC + createdAt DESC` index from the Firebase console.
9. **Rotate the reCAPTCHA secret** (owner, 5 minutes in recaptcha.google.com/admin). Open security task — rotate BEFORE any App Check work.
10. **Connect www.vowvy.com DNS** to GitHub Pages and create the OG image + favicons.
11. **Add analytics**: Firebase Analytics with five core events, page tracking on the landing page, users profile document at sign-in (see ANALYTICS_PLAN.md and DATA_MODEL_REVIEW.md).
12. **Deployed-rules security review** — audit collaborator rules; re-enable App Check per owner-documented steps.
13. **New-user setup questionnaire** — guide first-time users through naming their first location and container before landing on the main screen.
14. **PWA**: manifest, offline shell, install prompt, offline capture queue (APP_BUILD_PATH.md).
15. **Node.js runtime**: upgrade Cloud Functions from Node 20 before October 2026 deprecation.

## Future privacy work (not started, not scoped)

- Per-photo privacy
- Per-note privacy
- Per-collaborator permissions (per-helper access controls for packing/unloading/moving workflows)
  - Possible roles: Viewer, Packing helper, Unloading helper, Selected-place helper
- Clearer onboarding for sign-up vs sign-in distinction

## Rules

- New ideas discovered mid-task go to the idea backlog, not into the task.

Last updated: June 14, 2026.
