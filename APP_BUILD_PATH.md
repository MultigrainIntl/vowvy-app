# VOWVY App Build Path: PWA vs Native

Framework area 15 of the audit brief: should VOWVY become a PWA first or move toward native app development?

## Recommendation: PWA FIRST. Native later, only if specific triggers fire.

## Why PWA first

1. VOWVY is already a responsive web app on Firebase Hosting - the PWA step (manifest, service worker, install prompt, offline shell) is small and cheap.
2. The core needs - camera capture, photo upload, search, QR deep links - all work in the mobile browser today and improve slightly with PWA install (home screen icon, full screen, faster loads).
3. One codebase, instant updates, no app store review friction while the product is changing weekly.
4. The known pain (Chrome on iOS photo picker) is a browser quirk that a PWA does not fully escape but a clear install-to-home-screen flow (which uses Safari engine on iOS) largely sidesteps.

## What PWA does NOT give

- Reliable background work and push notifications on iOS are limited (improving, still second-class).
- Offline capture with deferred upload requires deliberate service worker work - worth doing for garages and storage units with no signal. Make offline capture part of the PWA issue, not an afterthought.

## Triggers that would justify going native (re-evaluate when any fires)

1. Users demonstrably demand push notifications or deep camera control (burst capture for Junk Drawer multi-object scanning may eventually want native camera APIs).
2. A B2B deal requires an app store presence for credibility or device management.
3. Offline-first becomes core to a paying segment (professional packers in dead zones).

If native happens, the sane route is a thin wrapper (Capacitor or similar) around the existing web app first, full native only if the wrapper hits a wall.

## Recommended next issue for this surface

A single PWA issue: manifest + icons, service worker with offline shell, install prompt, and offline capture queue. Schedule after code sync and analytics so impact is measurable.

Last reviewed: June 12, 2026.
