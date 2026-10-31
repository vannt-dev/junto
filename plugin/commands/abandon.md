---
description: Abandon the active junto task without finishing it (user-only action)
argument-hint: <reason>
allowed-tools: mcp__plugin_junto_junto__junto__task, mcp__junto__junto__task
---

JUNTO-ABANDON-SENTINEL-c41e8b

The user asked to abandon the active junto task. The reason they gave: $ARGUMENTS

The `state.js` hook recorded the request in `task.json`; you neither need nor are allowed to write it
yourself.

1. If no reason was given above, ask the user for one and stop.
2. Call `junto__task` with `action: "abandon"` and `reason` set to the user's reason, word for word.
3. Report that the task is archived at `.junto/archive/<id>/` as abandoned: it was not finished, and its
   `summary.md` records the reason, the phase it stopped in and the state of each gate.
