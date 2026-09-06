# junto M3a — generic CLI-spawned advisory backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `cliBackends` config section so a project can route an advisory role through a
locally installed CLI tool (Codex CLI, Gemini CLI, or anything else) instead of an HTTP API, without
changing the behavior of any existing `backends`-only config.

**Architecture:** Extract the PATH-resolution helpers already living inside `gates.ts` into a new
shared `packages/core/src/exec.ts` module. Add a `cliBackend(argv)` factory in
`packages/core/src/backends/cli.ts` that implements the existing `ModelBackend` interface by
spawning `argv` via `execa`, writing the joined prompt to stdin, and returning trimmed
stdout+stderr as `text` (with `tokensUsed: 0` always, since CLI tools report no usage figure).
Widen `resolveBackend`/`resolveRoleProvider` in `packages/core/src/backends/resolve.ts` from a
fixed `Provider` union to a plain `string`, and have `resolveBackend` check `config.backends` before
`config.cliBackends`. No change to `packages/mcp/src/tools/consult.ts` or `panel.ts` — both already
treat the resolved provider as a plain string.

**Tech Stack:** TypeScript strict, execa (existing dependency, already used by `gates.ts`), vitest
with real short-lived `node -e "..."` child processes (matching `gates.test.ts`'s established
style — no subprocess mocking).

**Spec:** `docs/superpowers/specs/2026-09-06-junto-m3-cli-backend-design.md` (this plan implements
it in full; read both together — the spec has the "why", this plan has the "how").

## Global Constraints

- Prefix every pnpm command with `corepack` (`corepack pnpm test`, etc.) — plain `pnpm` is not on
  PATH on this machine.
- Node.js 20.19+ or 22.12+ (the Vite/vitest dependency chain requires it).
- TypeScript strict mode with `noUncheckedIndexedAccess: true` — avoid non-null assertions (`x!`)
  in new production code.
- ESM imports include the `.js` extension; Node built-in imports use the `node:` prefix.
- No default exports. `src/index.ts` and `src/backends/index.ts` contain only re-exports
  (`export * from "./file.js"`), never logic.
- Every subprocess argv is an array, spawned via `execa` — never a concatenated shell string. This
  plan's one new spawn site (`cli.ts`) follows the exact pattern already used by `gates.ts`.
- **R1** — no file this plan touches lives outside `packages/*/src`, `packages/*/test`, and
  committed plugin bundles; no runtime code writes anywhere but `<project>/.junto/`, and this plan
  adds no new writes at all (a CLI backend's stdout is only ever returned in memory, exactly like
  the existing HTTP backends).
- **R2** — no runtime downloads, no `chmod`, no startup-time `npx`. The CLI tool a project
  configures under `cliBackends` must already be installed; junto only resolves it on `PATH` and
  spawns it.
- **R3** — does not apply the same way to a CLI backend (no API key for junto to route; the spec's
  §2 documents this explicitly). No code in this plan reads or stores a credential for a CLI
  backend.
- **R5** — this plan changes only the backend layer M2 already built. It does not touch
  `packages/core/src/transitions.ts` or `canEnter()`; nothing here can block a phase transition.
- `SCHEMA_VERSION` stays at `1` — `cliBackends` is a new, optional top-level field, and
  `roleSpecSchema.provider`'s widening from an enum to `z.string().min(1)` is backward-compatible
  (every previously-valid value, `"anthropic"` and `"openai"`, still parses).
- `canEnter()` is not touched by this plan.
- Tests that create temp directories remove them in `afterEach`.
- Conventional Commits, English subjects. Follow whatever attribution trailer rule your own
  session's instructions specify (this plan does not prescribe one for the commits its steps
  create).
- Stage only the files a task actually touches — never `git add -A`.
- Rebuild committed plugin artifacts (`corepack pnpm build`) after changing core, MCP, or hook
  source — this plan's final task does this once, after everything else is in place.

---

### Task 1: Extract PATH-resolution helpers into `packages/core/src/exec.ts`

**Files:**
- Create: `packages/core/src/exec.ts`
- Create: `packages/core/test/exec.test.ts`
- Modify: `packages/core/src/gates.ts`

**Interfaces:**
- Produces: `resolveExecutable(cmd: string, cwd: string): boolean`, exported from
  `packages/core/src/exec.ts`. Task 2's `cli.ts` imports this directly.

This is a pure extraction: `resolveExecutable`, `candidateExtensions`, and `existsAsExecutable`
already exist, unexported, inside `gates.ts` (lines 32-71 as read for this plan). Move all three,
unchanged, to the new module; export only `resolveExecutable` (the other two are internal
implementation details, exactly as private in the new module as they were in the old one).
`gates.ts`'s public API (`runGate`, `RunGateOptions`, `OUTPUT_TAIL_BYTES`) must not change.

- [ ] **Step 1: Write the failing test for the extracted module**

Create `packages/core/test/exec.test.ts`:

```ts
import { chmodSync, closeSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { resolveExecutable } from "../src/exec.js"

let dir: string
const tmpDirs: string[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "junto-exec-"))
  tmpDirs.push(dir)
})

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    rmSync(d, { recursive: true, force: true })
  }
})

describe("resolveExecutable", () => {
  it("finds a command on PATH by bare name", () => {
    // `node` itself is guaranteed to be on PATH in this test environment.
    expect(resolveExecutable("node", dir)).toBe(true)
  })

  it("returns false for a bare name not on PATH", () => {
    expect(resolveExecutable("junto-command-does-not-exist-abc123", dir)).toBe(false)
  })

  it("resolves a relative path against cwd", () => {
    const scriptPath = join(dir, "script.sh")
    closeSync(openSync(scriptPath, "w"))
    writeFileSync(scriptPath, "#!/bin/sh\necho hi\n")
    if (process.platform !== "win32") chmodSync(scriptPath, 0o755)
    expect(resolveExecutable("./script.sh", dir)).toBe(true)
  })

  it("returns false for a relative path that does not exist", () => {
    expect(resolveExecutable("./nope.sh", dir)).toBe(false)
  })

  it("returns false for a directory (not a file)", () => {
    const subdir = join(dir, "adir")
    mkdirSync(subdir)
    expect(resolveExecutable(subdir, dir)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run packages/core/test/exec.test.ts`
Expected: FAIL — `packages/core/src/exec.js` (or `.ts`) does not exist / cannot be resolved.

- [ ] **Step 3: Create `packages/core/src/exec.ts` by moving the three helpers out of `gates.ts`**

Create `packages/core/src/exec.ts`:

```ts
import { accessSync, constants, existsSync, statSync } from "node:fs"
import { delimiter, isAbsolute, join } from "node:path"

/** Candidate executable extensions. Try the original name first because it may already include one. */
function candidateExtensions(): string[] {
  if (process.platform !== "win32") return [""]
  const pathext = process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD"
  return ["", ...pathext.split(";").filter(Boolean)]
}

function existsAsExecutable(base: string): boolean {
  return candidateExtensions().some((ext) => {
    const candidate = base + ext
    if (!existsSync(candidate)) return false
    try {
      if (!statSync(candidate).isFile()) return false
      if (process.platform !== "win32") accessSync(candidate, constants.X_OK)
      return true
    } catch {
      return false
    }
  })
}

/**
 * Resolve `argv[0]` to a real executable before spawning. This deterministic
 * check avoids classifying localized or forwarded process output.
 */
export function resolveExecutable(cmd: string, cwd: string): boolean {
  if (cmd.includes("/") || cmd.includes("\\")) {
    const base = isAbsolute(cmd) ? cmd : join(cwd, cmd)
    return existsAsExecutable(base)
  }
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean)
  return dirs.some(dir => existsAsExecutable(join(dir, cmd)))
}
```

Then edit `packages/core/src/gates.ts`:
- Remove lines 32-71 (the `candidateExtensions`, `existsAsExecutable`, and `resolveExecutable`
  function definitions — keep `validGateName`, which stays in `gates.ts`).
- Remove the now-unused imports `accessSync, constants, statSync` from the `node:fs` import on
  line 1 (keep `existsSync, mkdirSync, writeFileSync`), and remove `delimiter, isAbsolute` from the
  `node:path` import on line 2 (keep `join`).
- Add `import { resolveExecutable } from "./exec.js"` alongside the other imports.

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm vitest run packages/core/test/exec.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Run the existing gates test suite to confirm the extraction changed nothing**

Run: `corepack pnpm vitest run packages/core/test/gates.test.ts`
Expected: PASS, unmodified — this proves the move changed no gate behavior.

- [ ] **Step 6: Typecheck**

Run: `corepack pnpm typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/exec.ts packages/core/src/gates.ts packages/core/test/exec.test.ts
git commit -m "refactor(core): extract PATH executable resolution into exec.ts"
```

---

### Task 2: `cliBackend` — the CLI-spawned `ModelBackend`

**Files:**
- Create: `packages/core/src/backends/cli.ts`
- Create: `packages/core/test/backends/cli.test.ts`

**Interfaces:**
- Consumes: `resolveExecutable(cmd: string, cwd: string): boolean` (Task 1, `../exec.js`);
  `CompleteInput`, `CompleteResult`, `ModelBackend` (`./types.js`, unchanged from M2).
- Produces: `cliBackend(argv: string[]): ModelBackend`. Task 4's `resolveBackend` calls this with
  `config.cliBackends[name].argv`.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/test/backends/cli.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { cliBackend } from "../../src/backends/cli.js"

describe("cliBackend", () => {
  it("writes the joined prompt to stdin and returns trimmed stdout", async () => {
    const backend = cliBackend(["node", "-e", "process.stdin.resume(); let d=''; "
      + "process.stdin.on('data', c => d += c); "
      + "process.stdin.on('end', () => { console.log(d.trim()); })"])
    const result = await backend.complete({ systemPrompt: "sys", userPrompt: "user" })
    expect(result.text).toBe("sys\n\nuser")
  })

  it("always reports tokensUsed as 0", async () => {
    const backend = cliBackend(["node", "-e", "process.stdin.resume(); process.stdin.on('end', () => {})"])
    const result = await backend.complete({ systemPrompt: "s", userPrompt: "u" })
    expect(result.tokensUsed).toBe(0)
  })

  it("sets model to the resolved command name", async () => {
    const backend = cliBackend(["node", "-e", "process.stdin.resume(); process.stdin.on('end', () => {})"])
    const result = await backend.complete({ systemPrompt: "s", userPrompt: "u" })
    expect(result.model).toBe("node")
  })

  it("throws with the exit code and captured output on a non-zero exit", async () => {
    const backend = cliBackend(["node", "-e", "process.stdin.resume(); "
      + "process.stdin.on('end', () => { console.error('boom'); process.exit(2) })"])
    await expect(backend.complete({ systemPrompt: "s", userPrompt: "u" }))
      .rejects.toThrow(/exited 2.*boom/is)
  })

  it("throws naming the effective timeout when the process runs too long", async () => {
    const backend = cliBackend(["node", "-e", "setTimeout(() => {}, 60000)"])
    await expect(backend.complete({ systemPrompt: "s", userPrompt: "u", timeoutMs: 200 }))
      .rejects.toThrow(/timed out after 200ms/i)
  })

  it("throws before spawning when the command does not resolve on PATH", async () => {
    const backend = cliBackend(["junto-command-does-not-exist-abc123"])
    await expect(backend.complete({ systemPrompt: "s", userPrompt: "u" }))
      .rejects.toThrow(/does not exist or is not executable/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run packages/core/test/backends/cli.test.ts`
Expected: FAIL — `packages/core/src/backends/cli.js` does not exist.

- [ ] **Step 3: Write `packages/core/src/backends/cli.ts`**

```ts
import { execa } from "execa"
import { resolveExecutable } from "../exec.js"
import type { CompleteInput, CompleteResult, ModelBackend } from "./types.js"

const DEFAULT_CLI_TIMEOUT_MS = 120_000

export function cliBackend(argv: string[]): ModelBackend {
  return {
    async complete({ systemPrompt, userPrompt, timeoutMs }: CompleteInput): Promise<CompleteResult> {
      const [cmd, ...args] = argv
      if (cmd === undefined) throw new Error("CLI backend argv is empty.")
      if (!resolveExecutable(cmd, process.cwd())) {
        throw new Error(`CLI backend command "${cmd}" does not exist or is not executable. Install it and retry.`)
      }

      const effectiveTimeoutMs = timeoutMs ?? DEFAULT_CLI_TIMEOUT_MS
      const res = await execa(cmd, args, {
        input: `${systemPrompt}\n\n${userPrompt}`,
        timeout: effectiveTimeoutMs,
        reject: false,
        all: true,
      })

      if (res.timedOut) {
        throw new Error(`CLI backend "${cmd}" timed out after ${effectiveTimeoutMs}ms.`)
      }
      if (res.exitCode !== 0) {
        throw new Error(`CLI backend "${cmd}" exited ${res.exitCode}: ${res.all ?? ""}`)
      }
      return { text: (res.all ?? "").trim(), tokensUsed: 0, model: cmd }
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm vitest run packages/core/test/backends/cli.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Typecheck**

Run: `corepack pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/backends/cli.ts packages/core/test/backends/cli.test.ts
git commit -m "feat(core): add cliBackend, a CLI-spawned ModelBackend"
```

---

### Task 3: Schema — `cliBackends` config field, widen `roleSpecSchema.provider`

**Files:**
- Modify: `packages/core/src/schema.ts`
- Modify: `packages/core/test/schema.test.ts`

**Interfaces:**
- Produces: `cliBackendSpecSchema` / `CliBackendSpec` (`{ argv: string[]; timeoutMs?: number }`),
  `Config["cliBackends"]?: Record<string, CliBackendSpec>`. `roleSpecSchema.provider` becomes
  `z.string().min(1)` — `RoleSpec["provider"]` becomes `string` (was `Provider`). `Provider` and
  `providerSchema` themselves are unchanged (`"anthropic" | "openai"`). Task 4's `resolve.ts` reads
  `config.cliBackends` and the widened `RoleSpec["provider"]`.

The existing test "rejects an unknown provider name in a role entry" (line ~100 of
`schema.test.ts`) encoded the *old* premise — that `provider` was a fixed two-value enum. That
premise is now false by design (spec §4): replace it, don't just delete it, with a test for the
constraint that does still hold (`provider` must be a non-empty string) and a test proving the new
capability (a `roles` entry naming an arbitrary `cliBackends`-shaped string is accepted, since
`resolveBackend` — not the schema — is what decides whether the name resolves to anything real).

- [ ] **Step 1: Write the failing schema tests**

In `packages/core/test/schema.test.ts`, replace this test:

```ts
  it("rejects an unknown provider name in a role entry", () => {
    expect(() => parseConfig({
      schemaVersion: 1,
      gates: {},
      roles: { adversary: { provider: "cohere" } },
    })).toThrow()
  })
```

with:

```ts
  it("accepts any non-empty provider name in a role entry (validity is resolveBackend's job, not the schema's)", () => {
    const cfg = parseConfig({
      schemaVersion: 1,
      gates: {},
      roles: { adversary: { provider: "codex" } },
    })
    expect(cfg.roles?.adversary?.provider).toBe("codex")
  })

  it("rejects an empty provider name in a role entry", () => {
    expect(() => parseConfig({
      schemaVersion: 1,
      gates: {},
      roles: { adversary: { provider: "" } },
    })).toThrow()
  })

  it("accepts a cliBackends block", () => {
    const cfg = parseConfig({
      schemaVersion: 1,
      gates: {},
      cliBackends: { codex: { argv: ["codex", "exec", "--json"], timeoutMs: 120000 } },
    })
    expect(cfg.cliBackends?.codex?.argv).toEqual(["codex", "exec", "--json"])
    expect(cfg.cliBackends?.codex?.timeoutMs).toBe(120000)
  })

  it("omits cliBackends cleanly when absent", () => {
    const cfg = parseConfig({ schemaVersion: 1, gates: {} })
    expect(cfg.cliBackends).toBeUndefined()
  })

  it("rejects a cliBackends entry with an empty argv", () => {
    expect(() => parseConfig({
      schemaVersion: 1,
      gates: {},
      cliBackends: { codex: { argv: [] } },
    })).toThrow()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run packages/core/test/schema.test.ts`
Expected: FAIL — `cliBackends` is unknown to the schema (fails via `.passthrough()`'s silent
accept for the "accepts" tests would actually *not* fail on parse, but `cfg.cliBackends?.codex` is
`undefined` since nothing named the field yet — assert this by running before Step 3 and observing
the "accepts a cliBackends block" test fail its `toEqual` assertion, and the "rejects an unknown
provider name" replacement tests fail because the old enum still rejects `"codex"`).

- [ ] **Step 3: Update `packages/core/src/schema.ts`**

Change `roleSpecSchema` (currently `provider: providerSchema`):

```ts
export const roleSpecSchema = z.object({
  provider: z.string().min(1),
  model: z.string().optional(),
}).strict()
```

Add, directly after `backendSpecSchema`:

```ts
export const cliBackendSpecSchema = z.object({
  argv: z.array(z.string()).min(1),
  timeoutMs: z.number().int().positive().optional(),
}).strict()
```

In `configSchema`, add a field alongside `backends`:

```ts
  cliBackends: z.record(z.string(), cliBackendSpecSchema).optional(),
```

Add the corresponding type export alongside `BackendSpec`:

```ts
export type CliBackendSpec = z.infer<typeof cliBackendSpecSchema>
```

`providerSchema` and `Provider` themselves are **not** changed — they keep meaning exactly
`"anthropic" | "openai"`, still used by `DEFAULT_ROLE_PROVIDER`'s type (Task 5 does not touch
`roles.ts`).

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm vitest run packages/core/test/schema.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck**

Run: `corepack pnpm typecheck`
Expected: no errors (this step surfaces any place that assumed `RoleSpec["provider"]` was the
narrow `Provider` type — Task 4 is exactly that place, handled next).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/schema.ts packages/core/test/schema.test.ts
git commit -m "feat(core): add cliBackends config schema, widen role provider to string"
```

---

### Task 4: Widen `resolveBackend`/`resolveRoleProvider`, resolve `cliBackends` entries

**Files:**
- Modify: `packages/core/src/backends/resolve.ts`
- Modify: `packages/core/test/backends/resolve.test.ts`

**Interfaces:**
- Consumes: `cliBackend` (Task 2, `./cli.js`); `Config["cliBackends"]`, widened `RoleSpec["provider"]:
  string` (Task 3, `../schema.js`).
- Produces: `resolveRoleProvider(role: string, config: Config): string` (return type widens from
  `Provider`); `resolveBackend(name: string, config: Config): ResolvedBackend` (parameter widens
  from `Provider`). Callers in `packages/mcp/src/tools/consult.ts` already treat both as plain
  strings (verified: `provider: ${provider}` template literal, `resolveBackend(provider, config)`
  with no further narrowing) — no changes needed there.

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/test/backends/resolve.test.ts` (after the existing `resolveBackend` describe
block):

```ts
describe("resolveBackend — cliBackends", () => {
  it("resolves a role whose provider names a cliBackends entry", () => {
    const config: Config = {
      ...baseConfig,
      cliBackends: { codex: { argv: ["node", "-e", "process.exit(0)"] } },
    }
    const resolved = resolveBackend("codex", config)
    expect(typeof resolved.backend.complete).toBe("function")
  })

  it("checks backends before cliBackends", () => {
    process.env.JUNTO_TEST_KEY = "sk-test"
    const config: Config = {
      ...baseConfig,
      backends: { dual: { apiKeyEnv: "JUNTO_TEST_KEY" } },
      cliBackends: { dual: { argv: ["node", "-e", "process.exit(0)"] } },
    }
    expect(() => resolveBackend("dual", config)).toThrow(/not a supported api vendor/i)
  })

  it("throws naming both config sections when a name is in neither", () => {
    expect(() => resolveBackend("nonexistent", baseConfig))
      .toThrow(/backends.*cliBackends|cliBackends.*backends/is)
  })

  it("throws clearly for a backends entry keyed by an unsupported vendor name, without falling through to openai", () => {
    process.env.JUNTO_TEST_KEY = "sk-test"
    const config: Config = { ...baseConfig, backends: { cohere: { apiKeyEnv: "JUNTO_TEST_KEY" } } }
    expect(() => resolveBackend("cohere", config)).toThrow(/not a supported api vendor/i)
  })
})
```

Also update the two existing tests in that file that call `resolveRoleProvider`/`resolveBackend`
with a literal type currently inferred as `Provider` — no source change needed there since `string`
accepts those same literals; only the new tests above are additive. Add the `Config` import already
present is sufficient (no new import needed beyond what Task 3 already typed).

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run packages/core/test/backends/resolve.test.ts`
Expected: FAIL — no `cliBackends` handling yet in `resolveBackend`, and the "before cliBackends" /
"unsupported vendor name" tests fail because the current code silently falls through to
`openaiBackend` instead of throwing.

- [ ] **Step 3: Rewrite `packages/core/src/backends/resolve.ts`**

```ts
import { anthropicBackend } from "./anthropic.js"
import { cliBackend } from "./cli.js"
import { openaiBackend } from "./openai.js"
import { DEFAULT_ROLE_PROVIDER, isBuiltInRole } from "./roles.js"
import type { ModelBackend } from "./types.js"
import type { Config } from "../schema.js"

export function resolveRoleProvider(role: string, config: Config): string {
  const configured = config.roles?.[role]?.provider
  if (configured !== undefined) return configured
  if (isBuiltInRole(role)) return DEFAULT_ROLE_PROVIDER[role]
  throw new Error(
    `Role "${role}" has no provider. Add roles: { "${role}": { "provider": "anthropic" | "openai" } } `
    + "to .junto/config.json.",
  )
}

export interface ResolvedBackend {
  backend: ModelBackend
  model?: string
  timeoutMs?: number
}

export function resolveBackend(name: string, config: Config): ResolvedBackend {
  const apiSpec = config.backends?.[name]
  if (apiSpec !== undefined) {
    const apiKey = process.env[apiSpec.apiKeyEnv]
    if (apiKey === undefined || apiKey === "") {
      throw new Error(
        `Environment variable "${apiSpec.apiKeyEnv}" is not set (required by backends.${name}.apiKeyEnv `
        + "in .junto/config.json).",
      )
    }
    if (name === "anthropic") return { backend: anthropicBackend(apiKey), model: apiSpec.model, timeoutMs: apiSpec.timeoutMs }
    if (name === "openai") return { backend: openaiBackend(apiKey), model: apiSpec.model, timeoutMs: apiSpec.timeoutMs }
    throw new Error(`"${name}" under "backends" is not a supported API vendor (only "anthropic" and "openai" are).`)
  }

  const cliSpec = config.cliBackends?.[name]
  if (cliSpec !== undefined) {
    return { backend: cliBackend(cliSpec.argv), timeoutMs: cliSpec.timeoutMs }
  }

  throw new Error(
    `No "${name}" entry under "backends" or "cliBackends" in .junto/config.json. `
    + `Add one under "backends" (API vendor) or "cliBackends" (spawned CLI tool).`,
  )
}
```

Note the API-key check on line "if (apiKey === undefined..." now runs before the vendor-name check
below it — this preserves the existing "checks env var before validating provider" ordering the
current tests already rely on (`resolveBackend("anthropic", baseConfig)` with no `backends` entry
throws "no ... entry" — unaffected; a `backends` entry present but keyed by an unsupported vendor
still requires its (bogus) `apiKeyEnv` to resolve to something before reaching the vendor check,
matching M2's existing precedent of checking the key before the value).

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm vitest run packages/core/test/backends/resolve.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full core test suite**

Run: `corepack pnpm vitest run packages/core`
Expected: PASS (all backend, schema, gates, exec, store, transitions, stale tests)

- [ ] **Step 6: Typecheck the whole workspace**

Run: `corepack pnpm typecheck`
Expected: no errors — this confirms `packages/mcp/src/tools/consult.ts` and `panel.ts` still
compile unmodified against the widened return/parameter types.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/backends/resolve.ts packages/core/test/backends/resolve.test.ts
git commit -m "feat(core): resolve cliBackends entries in resolveBackend"
```

---

### Task 5: Full workspace verification and plugin bundle rebuild

**Files:**
- None created or modified (verification + generated-artifact rebuild only).

**Interfaces:** None — this task consumes everything Tasks 1-4 produced and does not add new
surface area.

- [ ] **Step 1: Run the full test suite**

Run: `corepack pnpm test`
Expected: PASS, including `packages/mcp/test/**` and `test/hooks/**` — no test outside
`packages/core` should need any change, since `consult.ts`/`panel.ts` were never touched.

- [ ] **Step 2: Run the full typecheck**

Run: `corepack pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Rebuild committed plugin bundles**

Run: `corepack pnpm build`
Expected: succeeds; check `git status` afterward to see which built artifacts changed.

- [ ] **Step 4: Review and stage the rebuilt artifacts alongside anything else outstanding**

Run: `git status --short` and inspect the diff of any changed bundle file to confirm it's purely
the expected `cliBackend`/`resolveBackend`/`resolveRoleProvider`/schema changes, not an unrelated
stale rebuild. Stage only the actual build output paths (do not use `git add -A`).

- [ ] **Step 5: Commit**

```bash
git add <the specific rebuilt bundle paths from git status>
git commit -m "build: rebuild plugin bundles for the M3a CLI backend"
```

- [ ] **Step 6: Move the design spec from untracked to tracked**

The spec this plan implements, `docs/superpowers/specs/2026-09-06-junto-m3-cli-backend-design.md`,
is currently untracked. Commit it together with this plan file (both are documentation, not code,
so this can be its own small commit):

```bash
git add docs/superpowers/specs/2026-09-06-junto-m3-cli-backend-design.md docs/superpowers/plans/2026-09-06-junto-m3a-cli-backend.md
git commit -m "docs: add M3a CLI backend design spec and implementation plan"
```
