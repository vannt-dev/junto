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
- Node.js 22.12+ is required (Node.js 20 reached end of life on 2026-04-30).
- Add every new package project to the root `tsconfig.json` references.
- pnpm explicitly permits the esbuild install script through `pnpm.onlyBuiltDependencies`.

## Invariants

- **R1 - Project-only writes.** Runtime code may only create or modify files inside `<project>/.junto/`.
  Never touch `~/.claude`, user settings, or the project's root `.gitignore`.
- **R2 - No runtime downloads.** No downloaded binaries, `chmod`, CDN bootstrap, or startup-time `npx`.
- **R3 - Never persist secrets.** Configuration stores environment variable names, never API key values.
- **R5 - Deterministic gates, advisory panels.** Command exit codes and explicit severity policy over validated review findings may block a phase transition. Advisory consult/panel opinions cannot satisfy or block gates. Missing, incomplete or broken required reviews never pass.
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

The latest release is `0.6.2` (2026-10-15). Released so far: the task lifecycle with user-only plan
approval, hooks and commands, command and review gates bound to source hashes (OpenCodeReview and
host CLI reviewers), config `rules` and skills, read-only status, review reports, and advisory
consult/panel calls to Anthropic, OpenAI or a spawned CLI. `0.6.x` requires Node.js 22.12+ and
keeps `zod` on 3.x to keep hooks small and fast. Releases follow `docs/release-checklist.md`.
