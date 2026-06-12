# VOWVY Firebase Review

Framework areas: technical architecture and Firebase assumptions. IMPORTANT CAVEAT: this reviews the GitHub snapshot plus owner docs. The live Firebase project (vowvy-1ba5f) includes Cloud Functions, Gemini integration, and collaborator rules that are NOT in this repo, so parts of this review are provisional until the live code is pushed here.

## Architecture as visible in the snapshot - Verdict: Good for an MVP

- Frontend: React + TypeScript + Vite single-page app, hosted on Firebase Hosting.
- Auth: Firebase Authentication (email/password in snapshot; live app adds Google sign-in with custom auth domain app.vowvy.com, which correctly fixes Safari cookie issues).
- Database: Firestore, user-scoped paths (users/{uid}/containers/...).
- Storage: Firebase Storage for photos, user-scoped paths mirroring Firestore.
- The web config (API key, project IDs) in src/firebase.ts is public by design for Firebase web apps; it is not a secret. Protection comes from security rules, not from hiding the config.

## Live architecture per owner docs (not verifiable in this repo)

- Gemini 2.5 Flash for AI tagging and descriptions
- proxyImage Cloud Function (works around Safari CORS for images)
- Collaborator data model: users/{ownerUid}/collaborators/{uid} and invites/{token}
- Firebase Trigger Email extension installed but failing (SMTP 401)
- App Check: DISABLED (see SECURITY_REVIEW.md)

## Concerns

1. The deployed Firestore and Storage rules cannot be audited from this repo - the snapshot rules predate collaborators. Rule mistakes in sharing logic are the most common Firebase security failure; this must be reviewed once the live code is pushed.
2. Costs are unmeasured: Gemini calls per photo, Storage bandwidth from QR deep links, Cloud Function invocations. See RESOURCE_BUDGET.md - the audit recommends a simple monthly cost check.
3. No environment separation: one Firebase project serves as dev and prod. Acceptable now; worth a second project before any risky data-model refactor (the ghost-tags fix the owner already documented).

## Verdict: Good foundation, Needs work on visibility (rules and code must live in this repo).

Last reviewed: June 12, 2026.
