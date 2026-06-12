# VOWVY Mobile UX Review

Framework areas 4-5: UX/UI and mobile responsiveness. Caveat: hands-on review of the repo snapshot plus owner docs for the live app; a live walkthrough with a test account is recommended to finish this review.

## What is good

- The capture flow is genuinely minimal: location, container name, photo, save. Three fields and done - matches the capture-first philosophy.
- Location field remembers previous locations (datalist), reducing typing on repeat use.
- Photos are compressed on the phone before upload (max 0.5 MB), which keeps saves fast on mobile data and keeps storage costs down.
- Clear saving / saved feedback on the save button; friendly error messages on sign-in.
- The live app adds tablet two-column layout and iPad Safari fixes per owner docs.

## What needs work

1. Chrome on iPhone: the snapshot blocks the photo picker and shows a modal saying camera access requires Safari, with an Open in Safari button. That button links to the same URL - tapping a normal link in Chrome opens it in Chrome again, not Safari. The workaround likely does not work as intended. Better options: instruct the user to copy the link into Safari, or accept library uploads in Chrome and only steer camera capture to Safari.
2. One-handed use: the capture card sits at the top of the screen; on large phones the fields and save button are in the hardest-to-reach zone. Consider bottom-anchored capture controls.
3. No search box exists in the snapshot, so finding a container means scrolling. The live app reportedly has search; verify its placement is thumb-reachable.
4. No password reset in the snapshot sign-in screen (live app reportedly has it). Verify the link is visible on the phone keyboard-open layout.
5. Empty state is plain text only; a small illustration plus a one-line example would help first-time users.

## Quality gates affect mobile UX too

The Image Quality Gate (see PRODUCT_REVIEW.md) should run AT CAPTURE TIME on the phone where possible - warning about blur or low light when retaking costs two seconds, not later at publish time when the object may be packed away.

## Recommended next issue for this surface

Live mobile walkthrough with a test account (one-handed capture, search reachability, QR scan flow, Chrome iOS behavior), then fix the Chrome iOS workaround based on what is actually broken.

Last reviewed: June 12, 2026.
