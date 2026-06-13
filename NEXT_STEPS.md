# VOWVY Next Steps

Prioritized. Each item should become a GitHub issue before work starts. Long-term ideas live in PRODUCT_REVIEW.md and the agent-team-os idea backlog, not here.

## Immediate (confidence and cleanup)

1. **Live test privacy controls** as owner and as a collaborator. Verify: private locations hidden from collaborator, shared override works, lock icon reflects state, lightbox privacy panel updates in real time.
2. **Remove temporary backfill tooling** once privacy data confirmed correct. Remove: `backfillIsPrivateOnce`, `backfillLocationsVisibility`, `backfillContainersVisibility` from `functions/src/index.ts`; remove the three Admin screen panels from `src/AdminScreen.tsx`. Deploy functions + hosting.
3. **Deprecate old isPrivate field**: stop writing `isPrivate` on all new container creates; update Firestore rules to drop the `isPrivate` fallback once fully confirmed; remove the manual `isPrivate ASC + createdAt DESC` index from the Firebase console after rules no longer reference it.

## Up next (in order)

4. **New-user setup questionnaire** — guide first-time users through naming their first location and container before landing on the main screen. Reduces blank-state confusion.
5. **Rotate the reCAPTCHA secret** (owner, 5 minutes in recaptcha.google.com/admin). Open security task, not an emergency — nothing uses the old secret today, but rotate BEFORE any App Check work.
6. **Connect www.vowvy.com DNS** to GitHub Pages and create the OG image + favicons (biggest SEO and credibility win per hour spent).
7. **Add analytics**: Firebase Analytics with five core events, page tracking on the landing page, users profile document at sign-in (see ANALYTICS_PLAN.md and DATA_MODEL_REVIEW.md).
8. **Deployed-rules security review** — audit collaborator rules; re-enable App Check per owner-documented steps.
9. **Fix ghost AI tags** (tags belong to photos, not containers); move Gemini to structured output (DATA_MODEL_REVIEW.md spec).
10. **PWA**: manifest, offline shell, install prompt, offline capture queue (APP_BUILD_PATH.md).
11. **Marketplace track**: Image Quality Gate (on-device first), Junk Drawer draft items, quality-gated exports, direct API publishing (eBay/Etsy first).

## Future privacy work (not started, not scoped)

- Per-photo privacy
- Per-note privacy
- Per-collaborator permissions (per-helper access controls for packing/unloading/moving workflows)
  - Possible roles: Viewer, Packing helper, Unloading helper, Selected-place helper
- Clearer onboarding for sign-up vs sign-in distinction

## Rules

- New ideas discovered mid-task go to the idea backlog, not into the task.

Last updated: June 13, 2026.
