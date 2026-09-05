# junto system design

- Date: 2026-08-30
- Status: Approved
- Repository: https://github.com/vannt-dev/junto

## 1. Purpose

junto is a workflow engine for Claude Code. It keeps task state across conversations, prevents completion
without executable evidence, and can later request advisory opinions from external models.

The project deliberately avoids the unsafe patterns found in earlier workflow plugins: writes to global
Claude configuration, unauthenticated downloaded executables, transcript modification, and model-scored
"quality gates."

Goals:

1. Safety and transparency enforced by boundary tests.
2. A small, readable surface: commands, hooks, MCP tools, roles, and transition rules.
3. Durable disk state that survives compaction.
4. Verdicts produced by code and process exit status, never model claims.

## 2. Invariants

**R1 - Project-only writes.** junto only creates or changes files under `<project>/.junto/`. It never
changes `~/.claude`, user settings, or the project's root `.gitignore`.

**R2 - No runtime downloads.** Installed plugin artifacts are self-contained. Startup never downloads a
binary, runs `chmod`, contacts a CDN, or invokes `npx`.

**R3 - Never persist secrets.** Configuration stores environment variable names, never API key values.

**R4 - No bypass mechanism.** No skill or hook edits transcripts, configuration, or model refusals.

**R5 - Deterministic gates, advisory models.** Only the exit code of an executable command can block a
phase transition. Model opinions never become gates.

## 3. Architecture

The system has three parts:

1. A Claude Code plugin containing five M1 commands, four zero-dependency hook bundles, and one bundled MCP server.
2. An MCP server that owns task lifecycle, transitions, and gate execution.
3. `<project>/.junto/`, the sole durable state store and source of truth.

No state is expected to remain in memory between turns.

## 4. On-disk state

```text
.junto/
|-- .gitignore                  # contains *.log
|-- config.json
|-- active                      # active task ID
|-- roles/                      # optional project-defined roles
|-- tasks/<id>/
|   |-- task.json
|   |-- brief.md
|   |-- plan.md
|   |-- context.jsonl
|   |-- verdicts/<gate>.json
|   |-- verdicts/<gate>.log
|   `-- consults/NNN-<role>.md
`-- archive/<id>/
    `-- summary.md
```

Task IDs use `YYYY-MM-DD-<slug>`. Multiple tasks may exist, but only one is active. `baseCommit` records
`git rev-parse HEAD` when available and is `null` outside a Git repository. junto only reads Git state.

All persisted JSON contains `schemaVersion`. Files newer than the supported schema are rejected with a
clear upgrade message; unknown formats are never guessed.

## 5. Task lifecycle

M1 supports:

- `small`: build -> verify -> done
- `standard`: brief -> plan -> build -> verify -> done
- `deep`: identical to standard until M3 adds panel and review phases

Transitions are adjacent and one-way. Future size changes may only increase `small -> standard -> deep`.
The policy must remain in pure functions under `packages/core/src/transitions.ts`.

Transition rules:

1. brief -> plan requires a non-empty `brief.md`.
2. plan -> build requires `plan.md` and user approval, unless the size is explicitly auto-approved.
3. build -> verify is allowed.
4. verify -> done requires every required gate to have a readable, non-stale `pass` verdict.

Only the `UserPromptSubmit` hook may record `approvedBy: "user"`; no MCP tool may do so.

## 6. MCP tools

M1 exposes:

- `junto__task`: start, switch, and finish task lifecycle operations.
- `junto__advance`: request the next phase through the core transition policy.
- `junto__verify`: execute configured gates and persist evidence.

M2/M3 add `junto__consult`, `junto__panel`, API/CLI backends, and deep-task panel/review phases.
Every subprocess uses an argv array, observes timeouts, and never uses shell-string concatenation.

## 7. Quality gates

A gate is one command plus its exit status:

- `pass`: exit code 0.
- `fail`: non-zero exit or timeout.
- `skipped`: no process could start, commonly because the executable is missing.

`skipped` never satisfies a required gate. Full output is stored in a `.log`; the JSON verdict stores a
bounded output tail and metadata. Successful tool output stays terse, while failures return the useful tail.

Any relevant code edit marks existing verdicts stale. `staleIgnore` defaults to Markdown, docs, and `.junto`
paths. Three consecutive real failures prompt reconsideration of the plan; skipped runs do not affect the streak.

## 8. Hooks

- `session.js` (`SessionStart`): restore the full brief, plan, and recorded decisions after startup/resume/compaction.
- `state.js` (`UserPromptSubmit`): inject compact state and record explicit user approval.
- `handoff.js` (`PreToolUse` on Agent/Task): add selected `context.jsonl` files to subagent context.
- `guard.js` (`PreToolUse`/`PostToolUse` on editing tools): protect evidence files and mark verdicts stale.

The guard prevents ordinary editor-tool mistakes, not malicious Bash or external-editor writes. Hook failures
must never break the user's session.

## 9. Commands

M1 commands are `start`, `plan`, `approve`, `verify`, and `finish`. M2 adds `panel`.

`/junto:approve` contains a fixed sentinel so approval remains attributable to a user-submitted command even
when slash commands are expanded before `UserPromptSubmit` runs.

## 10. Packaging and verification

The plugin is self-contained and bundles four hooks plus the MCP server with esbuild. Generated artifacts are
committed. CI runs TypeScript checks, tests on Windows and Linux, boundary verification for R1, and a rebuild
followed by `git diff --exit-code` for artifact synchronization.

## 11. Out of scope

- Live web UI or server
- Domain-knowledge library
- Automatic strategy selection
- Multiple simultaneous active tasks
- Secret management
- Automatic Git commits or pushes
- Machine-global junto configuration

## 12. Milestones

- M0: core schema, storage, transition policy, stale matching, and gate runner.
- M1: usable task engine without external models.
- M2: API backends, advisory consult/panel tools, and roles.
- M3: CLI backends and full deep-task lifecycle.
- M4: public documentation, examples, marketplace publication, and release hardening.
