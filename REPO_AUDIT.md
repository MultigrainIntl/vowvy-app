# VOWVY Repo Audit (Master Document)

Audit date: June 12, 2026. Conducted under Agent Team OS Issue #1 (Project Review: VOWVY full-system audit). Read-only review: no app code was modified, nothing was deployed, Cloud Shell was not used.

## The single most important finding

THIS GITHUB REPO IS A STALE SNAPSHOT. The live app at app.vowvy.com is well ahead of the code stored here. The repo contains an early capture-only MVP (email sign-in, photo + location + name, a grouped list). The planning docs in the vowvy-website repo (STATE.md, June 7) describe the live app as having Google sign-in, Gemini AI tagging, full-text search, QR codes with deep links, a proxyImage Cloud Function, collaborator support, soft-delete trash, and password reset. None of that is in this repo.

Consequences:
1. GitHub is not currently the source of truth for VOWVY. The real code appears to live only on the owner machine and in Firebase deploys.
2. There is a single point of failure: if that machine is lost, the latest product code may be lost with it.
3. Every technical document in this audit (Firebase, security, data model) describes the snapshot, not necessarily the live system. Each carries a caveat.

Fix: push the current live codebase to this repo. This is the recommended first implementation issue (see NEXT_STEPS.md).

## Audit documents in this repo

- PROJECT_STATE.md - honest snapshot of what VOWVY is right now.
- PRODUCT_REVIEW.md - purpose, users, current state, and the feature roadmap including Junk Drawer and marketplace ideas.
- LANDING_PAGE_REVIEW.md - what vowvy.com promises vs what the app delivers.
- MOBILE_UX_REVIEW.md - phone experience, one-handed use, known iOS issues.
- FIREBASE_REVIEW.md - architecture and configuration.
- SECURITY_REVIEW.md - rules, data access, the reCAPTCHA secret task, public-repo exposure.
- DATA_MODEL_REVIEW.md - how data is organized, plus the structured AI output recommendation.
- ANALYTICS_PLAN.md - currently zero analytics; what to add.
- SEO_PLAN.md - findability of the landing page and app.
- GTM_PLAN.md - go-to-market, including mover partnerships and marketplace branding loops.
- BUSINESS_PLAN.md - the business model canvas for VOWVY.
- REVENUE_MODEL_CANVAS.md - full revenue brainstorm and shortlist.
- EXIT_READINESS.md - could VOWVY be sold or handed over today.
- APP_BUILD_PATH.md - PWA vs native app recommendation.
- RESOURCE_BUDGET.md - model, token, and cloud cost discipline.
- NEXT_STEPS.md - prioritized actions, each ready to become a GitHub issue.
- CLAUDE.md - rules for the repo operator in this project.
- CHANGELOG.md - history of meaningful changes.

## Verdict summary (Good / Needs work / Missing)

- Product idea and philosophy: Good
- Code quality of snapshot: Good (small, clean, readable)
- Repo as source of truth: Missing (stale snapshot)
- Security rules (snapshot): Good baseline; live rules unverified
- Analytics: Missing entirely
- SEO: Needs work (landing page decent, DNS and assets unfinished)
- Business and revenue thinking: Good foundation, already documented by owner
- Exit readiness: Needs work (key-person and backup risk)
