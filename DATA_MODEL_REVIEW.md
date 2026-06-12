# VOWVY Data Model Review

Framework area 7: database and data model. Caveat: the snapshot model is fully visible; the live model (tags, notes, trash, collaborators) is reconstructed from owner docs and could not be directly inspected.

## Snapshot model - Verdict: Good

users/{uid}/containers/{containerId} with: location, name, photoUrl, photoStoragePath, createdAt. Simple, owner-scoped, scales fine for personal use. Photos live at a mirrored Storage path - tidy and easy to clean up.

## Live model per owner docs

Adds: AI tags and descriptions, photo-level descriptions, notes with soft delete, deletedAt timestamps for 30-day trash, collaborators subcollection, and a top-level invites/{token} collection. One owner-documented flaw: AI tags belong to the container rather than to individual photos, so deleting a photo leaves ghost tags behind. The owner already plans a refactor; it should land AFTER the live code is in GitHub so the change is reviewable.

## Can the owner see users and usage? - Verdict: Missing

There is no users profile document created at signup, no signup timestamp in the database, and no usage events anywhere. Today the only way to see who signed up is the Firebase Console Auth tab, and there is no way at all to see what people do in the app. Recommendation: create a small users/{uid}/profile document at first sign-in (email, createdAt, lastSeenAt) and add analytics events (see ANALYTICS_PLAN.md). This is the difference between having users and knowing you have users.

## Structured AI output (recommendation from audit brief)

Current AI descriptions are reportedly verbose and sometimes speculative. Move Gemini to a strict structured output per item:

- itemName: short and concrete (Cast iron skillet, not A well-loved kitchen pan)
- description: one to two sentences, no speculation
- category: from a fixed list
- visibleAttributes: color, material, brand if clearly legible
- confidence: 0 to 1, stored, shown subtly
- marketplaceTitleDraft: optimized listing title (used only behind the quality gates)
- condition and estimatedValue: USER-CONFIRMED fields, never AI-asserted

Benefits: cheaper per photo (shorter outputs), better search (fields, not prose), honest (confidence is explicit, condition and value belong to the human), and marketplace-ready.

## Junk Drawer model implications

Multi-object capture needs: a draft item record per detected object (status: draft), a link back to the source photo, a rough crop image per object stored internally, and a quality flag. Draft items must be clearly separated from publish-ready items - the Marketplace Quality Gate (PRODUCT_REVIEW.md) is enforced at the data level by requiring a dedicated high-quality photo before an item can reach published status.

## Recommended next issue for this surface

After the code sync: fix the ghost-tags flaw by re-parenting tags to photos (owner-planned refactor), and add the users profile document at sign-in.

Last reviewed: June 12, 2026.
