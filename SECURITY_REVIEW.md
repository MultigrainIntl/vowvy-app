# VOWVY Security Review

Framework area 8: security and data governance. Written in plain English for a non-programmer. Caveat: the deployed rules are ahead of this repo and could not be fully audited.

## Data inventory

VOWVY holds: account identity (email, or Google identity), photos of personal belongings, location names, container names, AI-generated tags and descriptions, notes, and timestamps. Photos of home contents are sensitive - they can reveal valuables and layouts. The published privacy policy (vowvy.com/privacy.html) correctly names Firebase and Gemini as processors.

## What looks good

- The snapshot rules are correctly scoped: each user can only read and write their own data, everything else is denied by default. That is the right baseline.
- Photos are not publicly listed; storage paths are per-user.
- A privacy policy exists and is honest about third-party services.
- The redaction of the exposed secret from the website repo is complete on the current files (commit 0a35a57).

## Open security tasks (in priority order)

1. ROTATE THE reCAPTCHA SECRET (open task, not an emergency). The secret was committed to the public website repo and remains readable in git history. Evidence shows it is NOT used by anything today: App Check is disabled and the secret was never successfully registered. It becomes dangerous only when App Check is enabled. Required owner action before any App Check work: recaptcha.google.com/admin, select the Vowvy key, regenerate the secret, store it only in the console. Optionally scrub git history afterward (cosmetic once rotated).
2. AUDIT THE DEPLOYED RULES once live code is pushed. The collaborator rules (isActiveCollaborator on reads/writes) are exactly where subtle bugs hide - for example, whether a revoked collaborator truly loses access to photos as well as records.
3. ENABLE APP CHECK after rotation, following the owner-documented four steps. Until then, any client with the public config can talk to the backend, and only the rules stand in the way.
4. PHOTO LINK EXPOSURE: photo URLs are long-lived token links - anyone holding a URL can view that photo regardless of rules. Unguessable, but shareable and they leak into chat logs and QR flows. Record this as an accepted MVP trade-off, and revisit when collaborators and marketplace exports spread URLs further.
5. REPO VISIBILITY (owner decision): this app repo is PUBLIC and MIT licensed - anyone may legally copy the product. The website repo publicly exposes the full roadmap, pricing, and operational runbooks in STATE.md. Decide deliberately: keep public (open-source positioning) or go private (competitive and exit value).
6. CONTRIBUTOR ACCESS (future): the moving-company contributor workflow (PRODUCT_REVIEW.md) requires time-limited access that expires when the job ends, a clear record of who added what, and owner one-tap revoke. Build expiry in from day one - revocation-only models get forgotten.

## What was NOT done in this audit

No Firebase settings changed, nothing rotated, nothing deployed, no Cloud Shell. All findings are from repos, docs, and public pages.

## Verdict: Good baseline, Needs work on the five open tasks above. Nothing found that endangers user data today.

Last reviewed: June 12, 2026.
