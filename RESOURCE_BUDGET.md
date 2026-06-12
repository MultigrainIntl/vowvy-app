# VOWVY Resource Budget

Framework area 16. Token, model, and infrastructure cost discipline for this project. Global rules live in the agent-team-os repo.

## Model and token rules for VOWVY work

- Default model tier: Standard. The audit itself ran on Standard-tier discipline: targeted file reads, no full-repo dumps where avoidable, both repos cloned once and inspected locally.
- Premium tier: reserve for the deployed-rules security review (subtle logic), the ghost-tags data-model refactor design, and Junk Drawer object-detection prompt design. Tag these in their issues.
- Light tier: changelog updates, doc formatting, label and issue housekeeping.
- Cloud Shell: NOT USED in this audit; avoid going forward (quota).
- No repeated audits: this document set is the baseline; re-review only what changes.

## Cloud costs (currently unmeasured - start a simple monthly sheet)

| Service | Driver | Note |
|---|---|---|
| Gemini 2.5 Flash | per photo analyzed | Structured output (DATA_MODEL_REVIEW.md) shortens responses and cuts cost per photo; Junk Drawer multi-object analysis will raise per-photo cost - budget before building |
| Firebase Storage + bandwidth | photos, QR deep-link views | Client-side compression to 0.5 MB already controls this well |
| Cloud Functions | proxyImage and future export jobs | Watch invocations if marketplace export lands |
| Hosting, domain, email tool | flat-ish | Pick the email fix (Resend or SendGrid Web API) partly on price |

Budget alert suggestion: any single service crossing 25 dollars/month triggers a look; Gemini crossing 50 dollars/month triggers the structured-output work if not already done.

## Future feature cost notes

- Image Quality Gate: prefer on-device checks (resolution, blur estimate) before any AI call - free beats clever.
- Marketplace comps: external pricing data may carry per-call costs; price the feature before promising it.

Last reviewed: June 12, 2026.
