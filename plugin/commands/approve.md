---
description: Approve the plan for the active junto task (user-only action)
allowed-tools: mcp__junto__junto__advance
---

JUNTO-APPROVE-SENTINEL-7f3a9c

The user approved the plan. The `state.js` hook recorded approval in `task.json`; you neither need nor
are allowed to write it yourself. Follow the hook's result: if approval was refused, resolve the
reported prerequisite first. When the current phase is `plan`, advance a deep task to `panel` and
other sizes to `build`. When a rule required approval during another phase (including a small task),
continue that phase; do not attempt to move backwards to `build`.
