---
description: Show the active junto task, evidence, blockers, and next action
argument-hint: [all | html]
allowed-tools: mcp__plugin_junto_junto__junto__status, mcp__junto__junto__status
---

Show the current junto task status: $ARGUMENTS

Call `junto__status` and report its result without changing files or task state. Keep gate states,
the blocker, budget, warnings, and suggested next action intact. If there is no active task, say so
and stop.

- With `all`, call it with `all: true`: it lists the active task of every Git worktree of this
  repository (each worktree has its own `.junto/`), including worktrees with no active task.
- With `html`, call it with `html: true`: it does the same and also writes the read-only board
  `.junto/board.html`. Give the user the path it returns.

A `Warning: origin/main moved since verify` line means another branch was merged into the base
after this task's gates ran. It does not block the task; tell the user to merge the base into this
branch and run `/junto:verify` again.
