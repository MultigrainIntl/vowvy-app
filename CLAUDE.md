# Instructions for Claude Code - VOWVY (vowvy-app)

Start every session under AIOS Gate-Control.

Operating principle: Slow is smooth. Smooth is fast.

Required pattern: Observe -> Report -> Approve -> Patch -> Verify -> Stop.

Before implementation, report: current mission, current gate, out-of-scope items, allowed scope, forbidden actions, verification required, and stop condition.

Rules: one gate only, one scope only, no broad goals, no uncontrolled implementation, checkpoint before unclear or risky edits, and stop after verification/report.

If the build, typecheck, preview, or app load is broken, the only active gate is build repair -> verification -> report -> stop.

New-project or new-module work begins with an architecture gate before scaffolding or implementation.

Claude Code is the repo operator for VOWVY under AIOS. Read this and PROJECT_STATE.md before doing anything.

Work from a GitHub issue or owner-approved gate. If goal, scope, or acceptance criteria are unclear, ask first.

Read what the issue or gate points to; no full-repo reads by default.

Stay in scope; route new ideas to the idea backlog.

Describe exactly what will change and what will not, wait for explicit approval, then act.

End by reporting files changed, verification run, result, unresolved issues, and next recommended gate.
