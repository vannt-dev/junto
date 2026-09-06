# junto M3b design — deep-task panel and review lifecycle

- Date: 2026-09-06
- Status: Implemented
- Depends on: the base design, M2 advisory panel, and M3a CLI backend

## Purpose

Deep tasks use two explicit advisory checkpoints around implementation:

```text
brief -> plan -> panel -> build -> review -> verify -> done
```

Small and standard task lifecycles do not change.

## Transition policy

The existing brief and plan prerequisites still apply. For a deep task, user approval permits
`plan -> panel` rather than `plan -> build`. The transitions `panel -> build`, `build -> review`,
and `review -> verify` are adjacent and unconditional.

Panel output remains advisory under R5. A missing provider, exhausted consult budget, or failed
role must be reported by `junto__panel`, but none of those outcomes may block a transition. Only a
required quality gate with fresh command evidence can block `verify -> done`.

## User workflow

Entering `panel` tells the user to run `/junto:panel` to review the approved plan. Entering
`review` gives the same instruction for the implementation. The command applies useful feedback
at the agent's discretion, then advances to `build` or `verify` respectively. The panel tool stays
available as an optional standalone consultation in every other phase.

## Compatibility

Adding `panel` and `review` to the phase enum is an additive schema-version-1 change. Existing task
files contain only the old values and continue to parse. M3b neither changes persisted task fields
nor changes the API/CLI backend contract.
