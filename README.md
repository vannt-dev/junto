# junto

[![CI](https://github.com/vannt-dev/junto/actions/workflows/ci.yml/badge.svg)](https://github.com/vannt-dev/junto/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Workflow engine for Claude Code with durable on-disk state, evidence-based quality gates, and no runtime downloads.

## Installation

```bash
claude plugin marketplace add vannt-dev/junto
claude plugin install junto@junto
```

No `npx`, downloaded binary, or install script is required.

Requirements: Claude Code with plugin support and Node.js 20 or newer available on `PATH`.

## Usage

```text
/junto:start add JWT authentication to the API
/junto:plan
/junto:approve          # only the user can approve; the model cannot approve its own plan
/junto:panel [question] # deep: plan checkpoint; optional for other task sizes
# ...implementation...
/junto:panel [question] # deep: implementation review checkpoint
/junto:verify
/junto:finish
```

Small and standard tasks skip the two panel calls in this example. A deep task enters explicit
`panel` and `review` phases; panel opinions remain advisory and never replace quality-gate evidence.

`/junto:finish` only archives tasks in the `done` phase, so required gates cannot be bypassed by finishing early.

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

## Task data

Junto stores active task state under `.junto/tasks/<id>/` and archived tasks under
`.junto/archive/<id>/`. `task.json` contains lifecycle state, `brief.md` and `plan.md` contain the
working specification, `consults/` stores advisory responses, and `verdicts/` stores gate evidence.
Runtime log files are ignored by `.junto/.gitignore`; the rest can be retained as project history.

## Status

M1 provides the task engine without external models. M2 adds advisory multi-model consult/panel
(Anthropic + OpenAI). M3a adds a CLI-spawned backend (`cliBackends`) so a role can route to any
locally installed CLI tool instead of an HTTP API. See "Advisory consult and panel" below for
configuration. M3b adds `panel` and `review` checkpoints to deep tasks:
`brief -> plan -> panel -> build -> review -> verify -> done`. Both checkpoints remain advisory;
only quality-gate command results can block completion. M0 through M3 are implemented; M4 release
hardening is in progress.

MIT.
