# VOWVY Changelog

Newest first. Plain English: what changed and why it matters.

## June 12, 2026

- Full-system audit documents added (19 files) under Agent Team OS Issue #1: repo audit, project state, product/landing/mobile/Firebase/security/data-model reviews, analytics/SEO/GTM plans, business plan, revenue canvas, exit readiness, app build path, resource budget, next steps, repo-operator instructions, and this changelog. No app code was changed; nothing was deployed.
- Key findings: this repo is a stale snapshot of the live app (sync recommended as first implementation issue); zero analytics anywhere; reCAPTCHA secret previously exposed in the public website repo was redacted there (commit 0a35a57) and rotation is recorded as an open security task; strong product philosophy and owner monetization thinking confirmed.
- Roadmap ideas captured: Junk Drawer multi-object capture, Image Quality Gate, Marketplace Quality Gate, quality-gated marketplace exports and future publishing, subtle listing branding, resale comps support, moving-company contributor workflow, structured AI output spec.

## Prior to June 12, 2026

- See git history: initial MVP (email auth, photo + location + name capture, grouped list, client-side compression) and iOS Chrome photo-picker workarounds. The live app advanced beyond this repo via local development; that history lives outside GitHub until the code sync lands.
