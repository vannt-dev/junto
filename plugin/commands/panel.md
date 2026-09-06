---
description: Run an advisory multi-model panel review for the active junto task
argument-hint: [question for the panel]
allowed-tools: Read, mcp__junto__junto__panel, mcp__junto__junto__advance, mcp__code-review-graph__detect_changes_tool, mcp__code-review-graph__get_review_context_tool, mcp__code-review-graph__traverse_graph_tool, mcp__code-review-graph__get_impact_radius_tool
---

Ask the panel: $ARGUMENTS

Read `.junto/config.json`. If `consultContext.enabled` is true and code-review-graph tools are
available, use at most five minimal-detail graph calls. In the `panel` phase, collect the relevant
symbols and impact radius for the plan. In the `review` phase, start with changed files, then collect
their review context and impact radius. Pass one compact `context` object to `junto__panel` with
`source: "code-review-graph"`, the matching `purpose`, a synthesized summary, and project-relative
files. Do not pass raw whole files. If context is disabled or graph tools are unavailable, call the
panel without `context`; Junto must remain usable without the optional integration.

Call `junto__panel` with `question` set to the text above. junto__panel is advisory only — its
output never blocks a phase transition. Read each role's file under
`.junto/tasks/<id>/consults/` and use your own judgment about what, if anything, to change; do not
treat a role's opinion as a requirement.

For a deep task in the `panel` phase, apply any useful plan feedback and call `junto__advance` with
`to: "build"`. In the `review` phase, apply any useful implementation feedback and call it with
`to: "verify"`. Outside those phases, the panel remains an optional standalone consultation.
