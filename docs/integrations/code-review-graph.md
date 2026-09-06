# Optional code-review-graph integration

Junto can use source context produced by an independently configured
[code-review-graph](https://github.com/tirth8205/code-review-graph) MCP server.
The integration is optional: Junto does not install Python, download packages at runtime, manage the
graph database, or start another MCP server.

## Configure the graph server

Install and configure code-review-graph for Claude Code using its own documentation. To reduce MCP
schema overhead, expose only the tools Junto commands can use:

```json
{
  "mcpServers": {
    "code-review-graph": {
      "command": "code-review-graph",
      "args": [
        "serve",
        "--tools",
        "semantic_search_nodes_tool,get_review_context_tool,traverse_graph_tool,get_impact_radius_tool,detect_changes_tool"
      ]
    }
  }
}
```

Build the graph before starting a Junto task and keep it current using the graph tool's supported
update or watch mechanism. Follow the host project's instructions when a `repo_root` is required.

## Allow source context to leave the project

Junto consults may call remote APIs or a CLI that uses a remote model. Source-derived context is
therefore disabled by default. Enable it only when every configured advisory backend is permitted
to receive that source:

```json
{
  "schemaVersion": 1,
  "gates": {},
  "consultContext": {
    "enabled": true,
    "maxChars": 12000,
    "persist": true
  }
}
```

`maxChars` is capped at 50,000. A lower value reduces repeated panel input. With persistence
enabled, Junto writes the exact bounded snapshot to `.junto/tasks/<id>/contexts/` and references it
from each consult result. Junto marks this material as untrusted project data so source comments are
not treated as model instructions. Context remains advisory and never satisfies a quality gate.

## Fallback behavior

`/junto:plan` and `/junto:panel` try graph tools only when Claude Code exposes them. If the server is
missing or a corrected query remains empty, the commands continue with native inspection or without
attached panel context. The task lifecycle and quality gates do not depend on the graph integration.
