# junto

[![CI](https://github.com/vannt-dev/junto/actions/workflows/ci.yml/badge.svg)](https://github.com/vannt-dev/junto/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Website](https://img.shields.io/badge/website-vannt--dev.github.io%2Fjunto-c6f36b)](https://vannt-dev.github.io/junto/)

Workflow engine for Claude Code with durable on-disk state, evidence-based quality gates, and no runtime downloads.

[Explore the public site](https://vannt-dev.github.io/junto/) or install directly from the GitHub-backed marketplace below.

## Installation

```bash
claude plugin marketplace add vannt-dev/junto
claude plugin install junto@junto
```

No `npx`, downloaded binary, or install script is required.

Requirements: Claude Code with plugin support and Node.js 20 or newer available on `PATH`.

Verify the installed version or update an existing installation:

```bash
claude plugin details junto@junto
claude plugin update junto@junto
```

## Quick start

Run the first command inside a Git repository:

```text
/junto:start add JWT authentication to the API
/junto:status           # show phase, next action, blockers, gates, and advisory budget
/junto:plan
/junto:approve          # only the user can approve; the model cannot approve its own plan
/junto:panel [question] # deep: plan checkpoint; optional for other task sizes
# ...implementation...
/junto:status
# for a deep task, ask Claude to enter review; it calls junto__advance(to: "review")
/junto:panel [question] # deep: implementation review checkpoint
/junto:verify
/junto:finish
```

On first use, if `.junto/config.json` does not exist, `/junto:start` inspects familiar project
scripts and proposes quality gates for you to confirm before it writes the configuration.

Small and standard tasks skip the two panel calls in this example. A deep task enters explicit
`panel` and `review` phases. After implementation, the task must enter `review` before the second
`/junto:panel` call; the status command shows this as the next action. Panel opinions remain
advisory and never replace quality-gate evidence.

`/junto:finish` only archives tasks in the `done` phase, so required gates cannot be bypassed by finishing early.
`/junto:status` is read-only and uses the same transition policy and verdict files as the lifecycle tools.

## Five principles

1. **Write only inside the project.** junto only creates or changes files under `<project>/.junto/`.
   It never touches `~/.claude`, `settings.json`, or the project's root `.gitignore`. CI enforces this boundary.
2. **Never download code to execute.** No runtime binary, CDN, or `npx` bootstrap.
3. **Never store secrets.** Configuration stores environment variable names, never their values.
4. **No bypass skills.** junto never edits transcripts or circumvents a model refusal.
5. **Deterministic gates, advisory panels.** Only the exit code of a real command can block completion.

## Evidence, not promises

`junto__verify` runs test commands itself and records the result. A model cannot merely claim that tests passed.
When source files change, previous verdicts become stale and gates must run again.

The `guard.js` hook blocks evidence writes through Edit/Write/MultiEdit, but it **cannot block Bash**.
It prevents accidents and shortcuts; it is not a security boundary against a malicious actor.

## Advisory consult and panel

`junto__consult` asks one advisory role (`architect`, `adversary`, `pragmatist`, `reviewer`, or a
project-defined role) about the active task's brief and plan; `junto__panel` (via `/junto:panel`)
asks several roles in sequence. Both are strictly advisory: their output never blocks a phase
transition and is never evidence for a gate.

Advisory calls can optionally receive bounded source-derived context. This is disabled by default
because API and CLI backends may send that context outside the machine. Enable it explicitly:

```json
{
  "consultContext": { "enabled": true, "maxChars": 12000, "persist": true }
}
```

When enabled, `/junto:plan` and `/junto:panel` use a locally configured code-review-graph MCP server
when available, with native code inspection as a fallback. Junto does not install, start, or depend
on that server. Context is bounded before being repeated across panel roles and, by default, stored
under the active task's `contexts/` directory for auditability. See
[the code-review-graph integration guide](docs/integrations/code-review-graph.md).

Configure providers in `.junto/config.json`:

```json
{
  "schemaVersion": 1,
  "gates": {},
  "backends": {
    "anthropic": { "apiKeyEnv": "ANTHROPIC_API_KEY" },
    "openai": { "apiKeyEnv": "OPENAI_API_KEY" }
  },
  "cliBackends": {
    "codex": { "argv": ["codex", "exec", "--color", "never", "-"], "timeoutMs": 120000 }
  },
  "roles": {
    "adversary": { "provider": "codex" }
  },
  "consultBudget": { "maxTokensPerTask": 200000 }
}
```

`apiKeyEnv` names an environment variable holding the key — junto never stores the key value
itself. A role's `provider` can also name an entry under `cliBackends` — junto spawns the listed
command, writes the prompt to its stdin, and reads the response from stdout. Empty responses are
rejected and output is limited to 1 MB per stream. CLI backends have no token accounting
(`consultBudget` cannot cap their spend). Override any role's prompt by adding `.junto/roles/<role>.md`.

See [examples/config.basic.json](examples/config.basic.json) for a gate-only setup and
[examples/config.multi-model.json](examples/config.multi-model.json) for API and CLI advisory
backends. Copy one to `.junto/config.json` and adjust commands and environment-variable names for
the project. The Codex example uses `-` because `codex exec` requires that positional value to read
the prompt from stdin.

RTK can independently reduce shell output during implementation, but Junto deliberately runs gate
commands without RTK so their stored evidence remains raw. See [the RTK integration guide](docs/integrations/rtk.md).

## Task data

Junto stores active task state under `.junto/tasks/<id>/` and archived tasks under
`.junto/archive/<id>/`. `task.json` contains lifecycle state, `brief.md` and `plan.md` contain the
working specification, `consults/` stores advisory responses, and `verdicts/` stores gate evidence.
Runtime log files are ignored by `.junto/.gitignore`; the rest can be retained as project history.

## Current capabilities

- Durable small, standard, and deep task lifecycles.
- User-approved plans and evidence-backed quality gates.
- Read-only task status with next actions, blockers, gate state, and advisory budget usage.
- Anthropic, OpenAI, and generic CLI advisory backends with project-defined roles.
- Optional bounded source context and code-review-graph-aware planning and review.
- Self-contained Claude Code plugin with Windows and Linux CI coverage.

## Troubleshooting

- If a newly installed or updated command is missing, restart Claude Code to load the new plugin version.
- If Junto reports no project, run it inside a Git repository containing `.junto/config.json`, or use
  `/junto:start` to create the initial configuration.
- If an MCP command reports a closed connection once, start a new Claude Code session and retry. If it
  repeats, run `claude plugin details junto@junto` and confirm the installed version.

## Project links

- [Website](https://vannt-dev.github.io/junto/)
- [Releases](https://github.com/vannt-dev/junto/releases)
- [Changelog](CHANGELOG.md)
- [Report an issue](https://github.com/vannt-dev/junto/issues/new)

MIT.
