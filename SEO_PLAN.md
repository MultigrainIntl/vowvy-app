# VOWVY SEO Plan

Framework area 10: can people find VOWVY? Verdict: Needs work - decent bones, unfinished plumbing.

## What is already good

The landing page has a real title, meta description, canonical tag, Open Graph and Twitter card tags, semantic headings, and fast static hosting. That is more than most MVPs.

## The blocking problems (in order)

1. THE DOMAIN IS NOT CONNECTED. www.vowvy.com uses GoDaddy forwarding instead of DNS, so the canonical URL the page claims is not the URL actually serving it. Search engines see a GitHub Pages address with a canonical pointing elsewhere - this suppresses ranking. Fix: the owner-documented DNS steps (remove forwarding, four A records, www CNAME, enforce HTTPS). Half-hour task, biggest SEO win available.
2. THE OG IMAGE DOES NOT EXIST. Meta tags reference og-image.png which was never created, so shared links show broken previews. Create the 1200x630 image.
3. Favicons and apple touch icon missing (small trust signals).
4. The app itself has a bare title (just Vowvy) - fine, the app should not be the SEO surface, but give it a proper title and description anyway for bookmark and share contexts.

## Target search phrases (validate later with real data)

- what is in my storage boxes app
- moving box inventory app with QR codes
- home inventory app with photos and AI
- storage unit inventory app
- estate cleanout inventory tool

## Content plan (after DNS)

A small set of honest, useful pages: moving-box labeling guide, storage unit inventory checklist, estate cleanout walkthrough, home inventory for insurance. Each maps to a persona from VISION.md and naturally demonstrates the product. One page a month is enough; consistency beats volume.

## Recommended next issue for this surface

Connect DNS, then create the OG image and favicons - one issue, one afternoon, permanent benefit.

Last reviewed: June 12, 2026.
