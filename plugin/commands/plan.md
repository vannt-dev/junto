---
description: Write an implementation plan for the active junto task
allowed-tools: Read, Glob, Grep, Write, mcp__junto__junto__advance
---

Write an implementation plan for the active junto task.

1. Read `.junto/tasks/<id>/brief.md`.
2. Inspect enough of the codebase for the plan to reference real files.
3. Write `.junto/tasks/<id>/plan.md` with numbered steps, affected files, and verification for each step.
4. Write `.junto/tasks/<id>/context.jsonl`; each line is `{"file":"...","reason":"..."}` for files a subagent needs.
5. Call `junto__advance` with `to: "plan"` if the task is still in `brief`.

Then stop. Do not transition to `build`. Ask the user to review the plan and type `/junto:approve` if they agree.
