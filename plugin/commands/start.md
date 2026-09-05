---
description: Create a new junto task and choose its size
argument-hint: <work description>
allowed-tools: Read, Glob, Write, mcp__junto__junto__task
---

The user wants to start this work: $ARGUMENTS

Follow these steps in order:

1. If `.junto/config.json` does not exist, inspect `package.json`, `Cargo.toml`, `go.mod`, or `Makefile`
   for familiar scripts (`test`, `typecheck`, `lint`, `build`). Propose gates and ask the user to confirm
   before writing. Match only scripts that actually exist. Mark security gates (`npm audit`, `pip-audit`,
   `gosec`, `semgrep`) as `required: false` and explain which tools must be installed.
2. Choose a size and explain why:
   - `small`: one-file or fully understood work; starts directly in build.
   - `standard`: a feature or multi-file change; requires a brief, plan, and user approval.
   - `deep`: an architectural or high-risk change.
   When uncertain, choose the larger size. Size may increase but never decrease.
3. Call `junto__task` with `action: "start"`, a concise title, and the selected size.
4. For `standard`/`deep`, write `.junto/tasks/<id>/brief.md` with clarified requirements and exclusions.

Then stop and report. Do not write implementation code yet.
