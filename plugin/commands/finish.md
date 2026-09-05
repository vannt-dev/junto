---
description: Finish and archive the active junto task
allowed-tools: mcp__junto__junto__task, Read
---

Finish the active junto task.

1. Check the current phase. If it is not `done`, explain what remains and stop; the MCP tool rejects early archival.
2. Call `junto__task` with `action: "finish"`.
3. Report that the task is stored at `.junto/archive/<id>/`; `summary.md` records gates and decisions.
