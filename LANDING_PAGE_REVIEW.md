# VOWVY Landing Page Review

Covers the marketing site (vowvy-website repo, served at multigrainintl.github.io/vowvy-website; intended domain www.vowvy.com). Framework areas: landing page clarity and conversion.

## What the page promises

Headline: Spaces for everything that matters. Description: Photograph a box. AI catalogs everything inside. Find anything, anywhere - even years later. Sections: problem cards, how it works, six use cases, collaboration mockup, philosophy, and a Get Started call to action linking to app.vowvy.com.

## Promise vs app experience - Verdict: Roughly aligned with the LIVE app, ahead of this repo

The live app reportedly delivers AI cataloging and search, so the core promise is honest. Two gaps: the collaboration section shows an activity feed that is foundation-only today (invite UI not built), and the page references assets that do not exist yet (OG image), which breaks link previews when sharing.

## Conversion - Verdict: Needs work

1. The Get Started button correctly points at app.vowvy.com. Good.
2. There is no way to measure conversion: zero analytics on the page (see ANALYTICS_PLAN.md).
3. STATE.md notes the waitlist was replaced by the Get Started CTA; confirm no dead waitlist remnants remain.
4. The custom domain is not connected (GoDaddy forwarding instead of DNS A records). Visitors and search engines see an inconsistent address; the canonical tag claims www.vowvy.com which is not properly serving the site. This is the single biggest credibility and SEO fix available, and it is a 30-minute DNS task already documented step-by-step by the owner.

## Design - Verdict: Good

Consistent brand system (terracotta palette, Cormorant Garamond + Lora, golden-ratio sizing), mobile responsive, tasteful scroll animations, working phone mockup with cycling AI tags. Known cosmetic TODOs from owner docs: footer logo halo, checkmark color, real vector logo, favicons, apple touch icon.

## Recommended next issue for this surface

Connect www.vowvy.com DNS to GitHub Pages (remove GoDaddy forwarding, add the four A records and the www CNAME, enforce HTTPS), then add the missing OG image so shared links preview correctly.

Last reviewed: June 12, 2026.
