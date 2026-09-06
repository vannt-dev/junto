---
description: Approve the plan for the active junto task (user-only action)
allowed-tools: mcp__junto__junto__advance
---

JUNTO-APPROVE-SENTINEL-7f3a9c

The user approved the plan. The `state.js` hook recorded approval in `task.json`; you neither need nor
are allowed to write it yourself. For a deep task, call `junto__advance` with `to: "panel"` and stop so
the plan can receive its advisory panel review. Otherwise call it with `to: "build"`, then implement
step one of `plan.md`.
