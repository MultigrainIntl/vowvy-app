# Instructions for Claude Code - VOWVY (vowvy-app)

Claude Code is the repo operator for VOWVY under the Agent Team Operating System (see the agent-team-os repo). Read this and PROJECT_STATE.md before doing anything.

## Critical context

1. THIS REPO MAY BE STALE. As of June 12, 2026 the live app at app.vowvy.com is ahead of this repo. Until NEXT_STEPS.md item 1 (code sync) is done, do not assume this code matches production. Never deploy from this repo without owner confirmation that it is current.
2. This repo is PUBLIC and MIT licensed. Never commit secrets, keys, tokens, personal file paths, or customer data. Treat every commit as world-readable, because it is.
3. The owner follows SHOW -> APPROVE -> DO: describe exactly what will change and what will not, wait for explicit approval, then act. Working things are off limits unless specifically asked.

## Session rules

1. Work from a GitHub issue. If goal, scope, or acceptance criteria are unclear, ask first.
2. Read what the issue points to; no full-repo reads by default.
3. Stay in scope; route new ideas to the idea backlog.
4. Respect the model tier on the issue (default Standard; see RESOURCE_BUDGET.md).
5. Do not use Cloud Shell unless absolutely necessary.
6. Do not change Firebase settings, security rules, or deploy anything without an explicit issue and owner approval.
7. End sessions by updating PROJECT_STATE.md, NEXT_STEPS.md, and CHANGELOG.md, and reporting plainly.

## Project conventions

- Stack: React + TypeScript + Vite, Firebase (Auth, Firestore, Storage, Hosting, Functions in live app), Gemini for AI.
- Plain-English docs; the owner is a non-programmer - explain consequences, not just changes.

## Never touch without an explicit issue

- firestore.rules / storage.rules, Firebase console settings, billing, the live deployment, user data.
