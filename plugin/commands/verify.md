---
description: Run quality gates for the active junto task
argument-hint: [gate name; omit to run all]
allowed-tools: mcp__junto__junto__verify, mcp__junto__junto__advance
---

Run gates: $ARGUMENTS

If the task is in `build`, first call `junto__advance` with `to: "verify"`. Then call
`junto__verify`; do not run tests through Bash because self-reported output is not evidence.

- `pass`: when every required gate passes, call `junto__advance` with `to: "done"`.
- `fail`: fix the cause and rerun `junto__verify`; code changes invalidate old verdicts.
- `skipped`: explain which tool is missing and how to install it; this is not a pass.

If a gate fails three consecutive times, stop changing code and reconsider the plan.
