# VOWVY Analytics Plan

Framework area 9. Current state - Verdict: MISSING ENTIRELY. There is no analytics on the landing page, none in the app snapshot, and none mentioned in owner docs for the live app. VOWVY is flying blind: no visit counts, no conversion rate, no signup trend, no feature usage.

## KPIs that matter (keep it to five)

1. Weekly signups (new accounts)
2. Activation rate: percent of new accounts that save at least one container in week one
3. Weekly active users
4. Containers captured per active user per week (the core habit)
5. Search usage: percent of active users who search (proves the find-it-later promise)

## Events to track

| Event | Why |
|---|---|
| landing_visit and get_started_click | Landing conversion |
| sign_up | Growth |
| container_saved | Activation and habit |
| photo_added | Capture depth |
| search_performed | Promise delivered |
| qr_scanned | QR loop working |
| invite_accepted (later) | Collaboration adoption |

## Tool recommendation

Use a privacy-light tool (for example Plausible or a similar simple analytics service) on the landing page, and Firebase Analytics inside the app since the stack is already Firebase. Both are low-cost or free at current scale. Whatever is chosen, update privacy.html to name it - the policy is currently accurate precisely because nothing is tracked; keep it accurate.

## Owner visibility

Pair analytics with the users profile document recommended in DATA_MODEL_REVIEW.md so the owner can answer: how many users, who is new, who is active, what do they do. A simple weekly look at five numbers beats a dashboard nobody opens.

## Recommended next issue for this surface

Add Firebase Analytics with the five core events to the live app, and a page-view tracker to the landing page, in the same work session (small task, huge information gain).

Last reviewed: June 12, 2026.
