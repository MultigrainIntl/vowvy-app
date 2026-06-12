# VOWVY Project State

Last updated: June 12, 2026 (full-system audit). IMPORTANT: the live deployed app is ahead of this GitHub repo. Treat this repo as a stale snapshot until the live code is pushed here.

## What VOWVY is

A searchable memory system for physical possessions. Photograph a box or container, AI catalogs what is inside, and you can find anything later by searching. Philosophy: Capture first. Organize later.

## Status

- Stage: Active (live MVP with real functionality)
- Live app: https://app.vowvy.com (backup: https://vowvy-1ba5f.web.app)
- Marketing site: https://multigrainintl.github.io/vowvy-website/ (custom domain www.vowvy.com not yet pointed via DNS)
- App repo: this repo (STALE - live code not yet pushed)
- Website repo: MultigrainIntl/vowvy-website
- Firebase project: vowvy-1ba5f

## What works today (per owner docs for the LIVE app)

- Google sign-in with custom auth domain, sessions persist
- Password reset
- Locations, containers, photo capture and upload
- AI tags and descriptions via Gemini 2.5 Flash
- Full-text search across names, locations, tags, descriptions, notes
- QR code per container with deep links and printable labels
- Soft-delete trash with 30-day retention
- Collaborator data model deployed (invite UI not built)
- iPad Safari compatibility workarounds

## What works in THIS repo (the snapshot)

- Email/password sign-in, photo + location + container name capture, grouped list, client-side image compression. No AI, no search, no QR.

## What is broken or missing

- This repo lags the live app (the central problem)
- App Check disabled; reCAPTCHA secret was exposed and needs rotation (see SECURITY_REVIEW.md)
- Zero analytics anywhere
- www.vowvy.com DNS not connected; OG image and favicons missing on landing page
- Email notifications broken (SMTP 401, parked)
- Ghost AI tags persist after photo deletion (data model issue, owner-documented)
- Collaborator invite UI not built

## Current focus

- Complete this audit (done with this commit)
- Next: sync live code to GitHub, then rotate reCAPTCHA secret before any App Check work

## Out of scope right now

- New feature building until the audit-driven priorities are agreed (Junk Drawer and marketplace ideas are captured in PRODUCT_REVIEW.md and NEXT_STEPS.md, not started)
