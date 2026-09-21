# Changelog

All notable changes to junto are documented in this file. The project follows Semantic Versioning.

## [Unreleased]

- Keep selected CLI review filenames literal in Git diff, including paths with brackets, so excluded files cannot leak into review input.

### Added

- Host CLI review gates (`provider: "cli"`) using installed OCR delegation rules and bounded stdin context; opt-in live semantic evaluation.
- Shared version-1 finding schema/fixtures including source, nullable line and metadata.
- Review event log and `junto__report` with escaped static HTML export under `.junto/`.

- Review gates: a gate with `"type": "review"` runs OpenCodeReview (`ocr`, `npm install -g @alibaba-group/open-code-review`) through the same verdict evidence as command gates. A missing reviewer is `skipped`, a broken or timed-out reviewer is `fail`, and findings at `failOn` severities (default critical and high) are `fail`. The requirement context is passed as a bounded `review-background.md`; raw reviewer output is redacted and stored beside the normalized result.
- `junto__plan` MCP tool: deterministic plan from git changes, config `rules`, and the skill registry, written to `plan.resolved.json`.
- Config `rules` (glob to skills, gates, approval) and `skills.roots`; skills declare `appliesTo` and `tags` in frontmatter or in the collection's `skillset.json`.
- `ocr delegate preview` support for deterministic review scope without an LLM.
- Public GitHub Pages landing page with installation, lifecycle, status, and design-principle guidance.
- Automatic Pages deployment from the self-contained `site/` directory.

### Changed

- Review rules retain rename source paths and committed changes reversed by pending edits. Skill metadata follows the selected search root instead of merging shadowed definitions.
- Review evidence redacts error messages and escaped JSON values without corrupting JSON, removes stale raw output after an unavailable reviewer, and rejects truncated delegation previews.
- Added an opt-in real OCR preview smoke test (`OCR_SMOKE_BIN` points to an installed binary); no LLM or runtime download is required.
- Review verification and delegation preview cover both committed task changes and pending workspace edits; evidence retains each scope and a skipped scope never counts as a completed review.
- Rules now enforce gates and human approval at verification and phase transitions, including small or auto-approved tasks, omitted task gates, deleted files, and missing gate definitions.
- Changed-file resolution reports git failures instead of returning an empty list, handles paths with spaces and renames, and includes untracked files.
- Review findings share one severity/category vocabulary with governed-agent-sdlc; reviewer infrastructure failures are provider errors, never findings.
- Improve README onboarding with install verification, first-run behavior, explicit deep-task review
  transition guidance, troubleshooting, current capabilities, and project links.

## [0.4.0] - 2026-09-08

### Added

- Read-only `junto__status` tool and `/junto:status` command for task phase, next action, blockers,
  gate evidence state, and advisory token budget.

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

[0.4.0]: https://github.com/vannt-dev/junto/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/vannt-dev/junto/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/vannt-dev/junto/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/vannt-dev/junto/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/vannt-dev/junto/releases/tag/v0.1.0
