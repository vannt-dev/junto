---
description: Write an implementation plan for the active junto task
allowed-tools: Read, Glob, Grep, Write, mcp__junto__junto__advance, mcp__code-review-graph__semantic_search_nodes_tool, mcp__code-review-graph__get_review_context_tool, mcp__code-review-graph__traverse_graph_tool, mcp__code-review-graph__get_impact_radius_tool
---

Write an implementation plan for the active junto task.

1. Read `.junto/tasks/<id>/brief.md`.
2. Inspect enough of the codebase for the plan to reference real files. If code-review-graph tools
   are available, use at most five minimal-detail calls to locate symbols, retrieve exact context,
   and check impact radius before falling back to Read/Glob/Grep. Follow project instructions for
   `repo_root`; do not invent one. If graph tools are unavailable or still empty after one corrected
   retry, state the fallback briefly and continue with the native tools.
3. Write `.junto/tasks/<id>/plan.md` with numbered steps, affected files, and verification for each step.
4. Write `.junto/tasks/<id>/context.jsonl`; each line is `{"file":"...","reason":"..."}` for files a subagent needs.
5. Call `junto__advance` with `to: "plan"` if the task is still in `brief`.

Then stop. Do not transition to `build`. Ask the user to review the plan and type `/junto:approve` if they agree.
