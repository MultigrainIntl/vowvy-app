# VOWVY Next Steps

Prioritized. Each item should become a GitHub issue before work starts. Long-term ideas live in PRODUCT_REVIEW.md and the agent-team-os idea backlog, not here.

## Up next (in order)

1. SYNC LIVE CODE TO GITHUB (the recommended first implementation issue). Push the current local vowvy-app codebase, including Cloud Functions and the deployed Firestore/Storage rules, to this repo. Everything else depends on this. Standard tier, owner-driven push, Claude reviews after.
2. Rotate the reCAPTCHA secret (owner, 5 minutes in recaptcha.google.com/admin). Open security task, not an emergency - nothing uses the old secret today, but rotate BEFORE any App Check work.
3. Connect www.vowvy.com DNS to GitHub Pages and create the OG image + favicons (owner-documented steps; biggest SEO and credibility win per hour spent).
4. Add analytics: Firebase Analytics in the app with the five core events, page tracking on the landing page, and the users profile document at sign-in (see ANALYTICS_PLAN.md and DATA_MODEL_REVIEW.md).
5. Deployed-rules security review (Premium tier) - once item 1 lands, audit the live collaborator rules properly; then re-enable App Check per the owner-documented four steps.
6. Fix ghost tags (owner-planned refactor: tags belong to photos, not containers) and move Gemini to structured output (DATA_MODEL_REVIEW.md spec).
7. One B2B pilot proposal for the identified box company contact (GTM_PLAN.md).
8. PWA issue: manifest, offline shell, install prompt, offline capture queue (APP_BUILD_PATH.md).
9. Marketplace track, in order: Image Quality Gate (on-device first), Junk Drawer draft items, quality-gated listing EXPORTS with AI titles/descriptions/categories, branding attribution where platform rules allow, then direct API publishing (eBay/Etsy first).

## Rules

- Items 1-2 before anything else touches the app.
- New ideas discovered mid-task go to the idea backlog, not into the task.

Last updated: June 12, 2026.
