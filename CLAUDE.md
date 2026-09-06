# junto

Workflow lifecycle tooling for Claude Code: a policy-only `packages/core`, an MCP server, and four hooks.
The project language is **English** for comments, commits, documentation, runtime messages, and reports.

Authoritative documents:

- Design constraints: `docs/superpowers/specs/2026-08-30-junto-design.md`
- M0+M1 implementation record: `docs/superpowers/plans/2026-08-30-junto-m0-m1.md`

When the design and implementation record conflict, the design wins.

## Toolchain

Prefix pnpm commands with `corepack`:

```bash
corepack pnpm install
corepack pnpm test
corepack pnpm vitest run packages/core/test/example.test.ts
corepack pnpm typecheck
corepack pnpm --filter @junto/core add <package>
```

- Do not install pnpm globally or change `"packageManager": "pnpm@10.17.1"`.
- Node.js 20.19+ or 22.12+ is required by the Vite dependency chain.
- Add every new package project to the root `tsconfig.json` references.
- pnpm explicitly permits the esbuild install script through `pnpm.onlyBuiltDependencies`.

## Invariants

- **R1 - Project-only writes.** Runtime code may only create or modify files inside `<project>/.junto/`.
  Never touch `~/.claude`, user settings, or the project's root `.gitignore`.
- **R2 - No runtime downloads.** No downloaded binaries, `chmod`, CDN bootstrap, or startup-time `npx`.
- **R3 - Never persist secrets.** Configuration stores environment variable names, never API key values.
- **R5 - Deterministic gates, advisory panels.** Only a real command exit code may block a phase transition.
- Always spawn commands with argv arrays; never concatenate shell command strings.
- `SCHEMA_VERSION` remains 1 until an intentional migration is designed. Reject future schema versions clearly.
- `canEnter()` must stay pure. Pass all filesystem facts in through `TransitionContext`.
- Phase-transition policy lives only in `packages/core/src/transitions.ts`.
- Preserve `* text=auto eol=lf` in `.gitattributes` for Windows/Linux artifact reproducibility.

## Code conventions

- TypeScript strict mode with `noUncheckedIndexedAccess: true`; avoid non-null assertions.
- ESM imports include `.js`; Node imports use the `node:` prefix.
- No default exports. Package `src/index.ts` files contain only re-exports.
- Comments explain why, not what.
- Tests live under `packages/*/test/**/*.test.ts` or `test/**/*.test.ts`.
- Tests that create temporary directories must remove them in `afterEach`.
- Rebuild committed plugin artifacts after changing core, MCP, or hook source.

## Git conventions

- Use Conventional Commits with English subjects.
- Do not add `Co-Authored-By` or `Claude-Session` trailers.
- Stage only the files relevant to the change; do not use `git add -A`.
- `.superpowers/` is ignored and must never be committed.
- Do not create branches, merge, or push unless the user explicitly asks.

## Current status

M0 through M3a are implemented on `main`: core policy/storage/gates, hooks and commands, advisory
multi-model consult/panel, API and CLI-spawned backends, roles, and per-task token budgets. M3b adds
real `panel` and `review` phases to the deep-task lifecycle and is implemented in the current worktree.
Its source changes pass the full suite, typecheck, and committed-plugin rebuild. Interactive local-plugin
acceptance remains a manual step because it changes Claude Code state outside the repository.

Three minor review findings around `packages/core/src/backends/cli.ts` remain intentionally parked
outside M3b:

- a successful process with empty output is accepted as an empty advisory response;
- captured process output relies on execa's default buffer limit rather than a junto-owned bound;
- spawn/signal failures are not normalized into the stable CLI-backend error format used for exit codes and timeouts.

Do not mix these into lifecycle work: each changes the backend's observable error contract and needs
an explicit policy choice. Revisit them as one hardening change by first adding focused `cli.test.ts`
cases, then updating `cli.ts`, running the full suite/typecheck, and rebuilding the plugin bundles.
