# Changelog

All notable changes to junto are documented in this file. The project follows Semantic Versioning.

## [0.3.0] - 2026-09-06

### Added

- Optional, bounded, persisted source context for advisory consults and panels.
- Optional code-review-graph guidance for plan and deep-task review commands.
- RTK compatibility guidance that preserves raw quality-gate evidence.

### Security

- Require explicit source-context egress opt-in, enforce bounded project-relative metadata, and mark
  source-derived context as untrusted data before sending it to advisory backends.

## [0.2.1] - 2026-09-06

### Fixed

- Move the bundled MCP configuration to the plugin root so Claude Code discovers Junto's MCP server
  and exposes its five tools after marketplace installation.

## [0.2.0] - 2026-09-06

### Added

- Advisory Anthropic and OpenAI backends with configurable roles and per-task token budgets.
- `junto__consult` and `junto__panel`, plus the `/junto:panel` command.
- Generic CLI-spawned advisory backends through `cliBackends`.
- Deep-task `panel` and `review` lifecycle phases.
- Valid basic and multi-model configuration examples.

### Changed

- CLI backends now resolve and run relative to the junto project root.
- CLI output is bounded to 1 MB per stream and empty responses are rejected.
- Spawn, signal, timeout, and non-zero-exit failures have explicit error messages.

## [0.1.0] - 2026-09-05

- Initial task lifecycle, durable project-local state, hooks, MCP tools, and evidence-based gates.

[0.3.0]: https://github.com/vannt-dev/junto/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/vannt-dev/junto/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/vannt-dev/junto/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/vannt-dev/junto/releases/tag/v0.1.0
