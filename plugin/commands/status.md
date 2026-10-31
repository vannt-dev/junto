---
description: Show the active junto task, evidence, blockers, and next action
allowed-tools: mcp__plugin_junto_junto__junto__status, mcp__junto__junto__status
---

Show the current junto task status.

Call `junto__status` and report its result without changing files or task state. Keep gate states,
the blocker, budget, and suggested next action intact. If there is no active task, say so and stop.
