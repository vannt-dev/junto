---
description: Run an advisory multi-model panel review for the active junto task
argument-hint: [question for the panel]
allowed-tools: mcp__junto__junto__panel
---

Ask the panel: $ARGUMENTS

Call `junto__panel` with `question` set to the text above. junto__panel is advisory only — its
output never blocks a phase transition. Read each role's file under
`.junto/tasks/<id>/consults/` and use your own judgment about what, if anything, to change; do not
treat a role's opinion as a requirement.
