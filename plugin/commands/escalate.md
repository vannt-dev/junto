---
description: Raise the size of the active junto task (small -> standard -> deep)
argument-hint: <standard|deep> <reason>
allowed-tools: Read, Glob, Write, mcp__junto__junto__task, mcp__junto__junto__status
---

The user wants to raise the size of the active junto task: $ARGUMENTS

Use this when the work turned out bigger or riskier than the size chosen at `/junto:start`. The size
can only go up (small -> standard -> deep); junto refuses to lower it.

1. If the user did not name a larger size or give a reason, ask for them and stop. If you are
   suggesting the raise yourself, explain why and wait for the user to agree before calling the tool.
2. Call `junto__task` with `action: "escalate"`, `size` set to the new size, and `reason` set to why the
   task grew.
3. Follow the tool's result. The task keeps its current phase and every gate verdict already recorded.
   - If the task was past the plan step (a small task in `build` or `verify`), the larger size owes the
     plan it skipped: fill `.junto/tasks/<id>/brief.md`, write `plan.md` (see `/junto:plan`, but do not
     advance), and ask the user to type `/junto:approve` unless the new size is auto-approved. The task
     cannot leave its current phase until then.
   - For `deep`, run `/junto:panel` on the plan if the task already passed plan approval; after build
     the task enters `review` before `verify`.
4. Report the new size, what is now owed, and the next action from `junto__status`.
