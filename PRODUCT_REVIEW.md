# VOWVY Product Review

Covers Project Review Framework areas 1-3 plus the product roadmap ideas from the audit brief. Verdicts: Good / Needs work / Missing. Caveat: based on the repo snapshot, owner planning docs, and the public landing page; the live app is ahead of this repo.

## 1. Product purpose - Verdict: Good

VOWVY answers a real, painful question: what is in that box, and where is it? The framing as a memory system (not inventory software) is emotionally smart and differentiating. The capture-first philosophy (fewer taps, AI does the organizing) is the right bet: friction kills documentation habits.

## 2. Target user - Verdict: Good, could be sharper

Primary persona per VISION.md: the Overwhelmed Mover - packing boxes, dreading the mystery-box problem months later. Strong secondary audiences already identified: professional organizers, estate cleanouts, resellers, storage customers, box rental companies. Recommendation: keep the mover as the single hero persona on the landing page; serve the others through B2B plans rather than diluting the message.

## 3. Current state - Verdict: Needs work (visibility, not quality)

The live app reportedly delivers the core promise: capture, AI tags, search, QR codes. But the GitHub repo does not contain that product, there are no analytics to prove usage, and key polish items are unfinished (DNS, email notifications, invite UI). The product is further along than the repo suggests and less measurable than a business needs.

## Roadmap ideas captured in this audit

### Junk Drawer (multi-object capture)
One photo of many objects. AI identifies each object, creates draft item records, and isolates a rough cropped image per object for internal inventory. Purpose: make bulk capture nearly effortless - the drawer, the shelf, the tabletop sweep. These drafts are internal working records, not publish-ready content.

### Marketplace Quality Gate
Junk Drawer crops must NOT flow directly to marketplaces. Publishing a listing requires a higher-quality individual photo of that item. Drafts exist to remember things; listings exist to sell things. Keeping that line protects both the seller and the VOWVY brand.

### Image Quality Gate
Before any listing is published or exported, VOWVY should check photo quality: resolution, compression artifacts, blur, lighting, how large the object appears in frame, and background clutter. Below-threshold photos get a friendly retake prompt with specific guidance (more light, closer, plain background).

### External marketplace publishing (future)
Evaluate preparing and pushing listings to Facebook Marketplace, Etsy, eBay, or similar. Realistic path: start with perfectly formatted copy-paste exports (title, description, category, price suggestion, photos), then add direct API publishing where platforms allow it (eBay and Etsy have APIs; Facebook Marketplace is restrictive). This turns VOWVY from memory tool into money tool.

### Marketplace branding
Where platform rules allow, add subtle VOWVY attribution to listing assets: a clean listing-card image template, a small watermark or footer strip, a QR code back to the item, or Created with VOWVY text. Every listing becomes an advertisement. Must stay subtle - the listing belongs to the seller, not to VOWVY.

### Resale comps and pricing support
Evaluate AI-generated listing descriptions, category suggestions, comparable-item values, and price ranges. Comps likely need a data partner or marketplace API; start with category + condition based price ranges and clearly label estimates as estimates.

### Moving company contributor workflow
Temporary contributor access for movers and packers: they photograph items, label boxes, apply QR codes, and build the inventory during packing; access expires when the job ends. The collaborator foundation already deployed in the live app is the natural base. This is also a B2B sales wedge (see GTM_PLAN.md).

### AI description quality
Current AI descriptions are reportedly verbose and sometimes speculative. Recommendation: tighter structured output per item - concise item name, one-to-two sentence description, category, visible attributes (color, brand if legible, material), a confidence score, a draft marketplace title, and user-confirmed fields for condition and value. Structured output is also cheaper per photo and makes search and export better. Details in DATA_MODEL_REVIEW.md.

## Recommended next GitHub issue (area 17)

Sync the live VOWVY codebase to this repo. Everything else - including every roadmap idea above - depends on the real code being visible, reviewable, and backed up.

Last reviewed: June 12, 2026 by Claude (repo operator), under ChatGPT-managed Issue #1.
