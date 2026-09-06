# junto M3a design — generic CLI-spawned advisory backend

- Date: 2026-09-06
- Status: Approved
- Depends on: `docs/superpowers/specs/2026-09-06-junto-m2-design.md` (M2, implemented; this spec
  adds to it without changing any of its behavior for existing configs)

## 1. Purpose

M3 (per the base design, `docs/superpowers/specs/2026-08-30-junto-design.md` §12) is "CLI backends
and full deep-task lifecycle." This spec covers only the first half — a generic backend that
spawns a locally installed CLI tool (Codex CLI, Gemini CLI, or anything else) instead of calling an
HTTP API. The deep-task lifecycle (a real `panel`/`review` phase for `size: "deep"`) is a separate,
independent spec — it touches `packages/core/src/transitions.ts` and phase policy, while this one
touches only the backend layer M2 already built. Splitting them keeps each spec reviewable and
lets this smaller, lower-risk piece ship without waiting on the higher-risk phase-policy change.

## 2. Invariants

No changes to R1-R5. Two things specific to this spec:

- **Argv-as-array (project-wide rule, already in `CLAUDE.md`):** the CLI backend spawns exactly
  like `packages/core/src/gates.ts` already does — an argv array via `execa`, never a shell string.
- **R3 does not apply the same way here.** A CLI backend has no API key for junto to route — the
  installed CLI tool manages its own credentials outside junto entirely. junto never touches them.

## 3. Why a separate `cliBackends` config map, not a `kind` field on `backends`

The obvious-looking design is to add `kind: "api" | "cli"` to the existing per-entry schema under
`backends`. That would be wrong here: M2 shipped `backends.<name>: { apiKeyEnv, model?, timeoutMs? }`
with `.strict()` and no `kind` field, and real `.junto/config.json` files already exist in that
shape. Adding a required discriminant would make every existing M2 config fail to parse under
`SCHEMA_VERSION` 1 — exactly the kind of accidental migration `CLAUDE.md` says not to do casually.

Instead, this spec adds a new, independent, optional top-level config field, `cliBackends`,
parallel to `backends`. Existing configs are byte-identical in behavior; the new capability is
purely additive, matching how every prior milestone (M1 -> M2) added a new optional field rather
than reshaping an existing one.

## 4. Schema

```ts
export const cliBackendSpecSchema = z.object({
  argv: z.array(z.string()).min(1),
  timeoutMs: z.number().int().positive().optional(),
}).strict()
```

`configSchema` gains:

```ts
cliBackends: z.record(z.string(), cliBackendSpecSchema).optional(),
```

`roleSpecSchema.provider` widens from `providerSchema` (the fixed `"anthropic" | "openai"` enum)
to `z.string().min(1)` — this is a backward-compatible widening: every value that was previously
valid (`"anthropic"`, `"openai"`) still parses. A role's `provider` is now simply "the name of an
entry in either `backends` or `cliBackends`," not a fixed two-value choice.

`Provider` (`z.infer<typeof providerSchema>`, the `"anthropic" | "openai"` type) is unchanged and
keeps its existing, narrower meaning: it is still exactly the set of supported HTTP API vendors,
used internally by `resolveBackend`'s API branch and by `DEFAULT_ROLE_PROVIDER`'s type (the four
built-in roles' *default* provider is always an API vendor, never a CLI backend — a project must
opt a role into a CLI backend explicitly via `config.roles`).

Example config:

```json
{
  "backends": {
    "anthropic": { "apiKeyEnv": "ANTHROPIC_API_KEY" }
  },
  "cliBackends": {
    "codex": { "argv": ["codex", "exec", "--json"], "timeoutMs": 120000 }
  },
  "roles": {
    "adversary": { "provider": "codex" }
  }
}
```

## 5. The CLI contract: stdin in, stdout out

There is no per-tool special-casing and no argv placeholder templating language. The contract a
project's `argv` must satisfy is exactly what M2's API backends already promise structurally: send
a prompt, get text back. Concretely:

1. junto spawns `argv` as-is via `execa`, exactly like `gates.ts` spawns a gate command.
2. junto writes the full prompt (`systemPrompt` and `userPrompt`, newline-joined) to the child
   process's stdin, then closes it.
3. junto reads the child's combined stdout+stderr once it exits.
4. Exit code `0` -> the captured output (trimmed) is the response text. Non-zero -> an error.

A CLI tool that expects its instructions as a command-line argument instead of stdin does not fit
this contract in M3a — the project would need a wrapper script that reads stdin and re-invokes the
tool with an argument. This is a real, documented limitation, not an oversight: templating argv
placeholders is exactly the kind of "automatic strategy selection" the base spec (§11) already
rules out, and a wrapper script is a one-line, project-owned fix.

## 6. No token accounting for CLI calls

CLI tools do not return a structured token-usage figure the way the Anthropic/OpenAI HTTP APIs do.
`cliBackend(...).complete(...)` always returns `tokensUsed: 0`. This is a real, stated limitation:
`consultBudget.maxTokensPerTask` cannot cap spend on a role routed through a CLI backend, because
there is nothing to count. Projects that care about bounding CLI-backend usage must rely on the
CLI tool's own limits (or the OS's process controls), not junto's budget.

`model` in the returned `CompleteResult` is set to the resolved command name (`argv[0]`) — CLI
backends have no model-selection concept, but the field must be populated for the consult file's
frontmatter, and the command name is the only meaningful identifier available.

## 7. `packages/core/src/backends/cli.ts`

`cliBackend(argv, root)` resolves and spawns the configured command relative to the explicit junto
project root. It writes the joined prompts to stdin, applies the configured timeout or the 120000ms
default, captures combined output, and returns the trimmed response with `tokensUsed: 0`.

The capture is bounded to 1000000 bytes per stdout/stderr stream. Empty successful responses,
buffer overflow, spawn failures, signal termination, timeout, and non-zero exit are distinct errors
with messages that name the configured command. `reject: false` lets junto classify execa results;
the surrounding catch normalizes failures thrown before a result exists.

## 8. Shared PATH-resolution helper: extract, don't duplicate

`resolveExecutable`, `candidateExtensions`, and `existsAsExecutable` already exist as unexported
helpers inside `packages/core/src/gates.ts`, doing exactly the check `cli.ts` needs (does this
command resolve to a real, executable file on `PATH`, accounting for Windows `PATHEXT`). Move all
three, unchanged, to a new `packages/core/src/exec.ts`, exported from there. `gates.ts` imports them
from the new module instead of defining them; its public API (`runGate`, `RunGateOptions`,
`OUTPUT_TAIL_BYTES`) does not change. This is a pure extraction — no behavior change to gate
execution, verified by gates.ts's existing test suite continuing to pass unmodified.

## 9. `resolveBackend` and `resolveRoleProvider`

`resolveRoleProvider(role: string, config: Config): string` — return type widens from `Provider`
to `string` (a config override can now name a CLI backend; the four built-in defaults still return
exactly `"anthropic"` or `"openai"`, which remain valid `string` values).

`resolveBackend(name: string, config: Config): ResolvedBackend` — parameter widens from `Provider`
to `string`. New logic, checking `backends` (API) before `cliBackends`, and — unlike M2's
`provider === "anthropic" ? anthropicBackend(apiKey) : openaiBackend(apiKey)`, which was only ever
safe because the caller's type was statically restricted to those two values — now uses an
explicit, exhaustive check rather than an else-defaults-to-openai fallthrough, since `name` is no
longer statically restricted:

```ts
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

This closes a latent gap in M2's code as a side effect: previously, any string other than exactly
`"anthropic"` silently fell through to `openaiBackend`. That was unreachable in M2 because
`Provider`'s type made it impossible, but it is exactly the kind of bug a widened `string` parameter
would otherwise reintroduce silently.

## 10. Error handling summary (additions to M2's table)

| condition | outcome |
|---|---|
| `cliBackends.<name>.argv[0]` not resolvable on `PATH` | refuse before spawning, clear message naming the command |
| spawned CLI process exits non-zero | error includes exit code and captured output |
| spawned CLI process exceeds its timeout | error names the effective timeout (config value or the 120000ms default) |
| spawned CLI process returns an empty response | clear error; no consult file or budget update |
| stdout or stderr exceeds 1000000 bytes | terminate capture and report the junto-owned limit |
| process cannot start or is terminated by a signal | stable error naming the CLI backend and cause |
| a role's `provider` matches neither `backends` nor `cliBackends` | clear error naming both config sections as the place to declare it |
| a `backends` entry's key is neither `"anthropic"` nor `"openai"` | clear error naming the unsupported vendor (no silent fallthrough) |

## 11. Testing

- `packages/core/test/exec.test.ts`: the three extracted helpers, carrying forward whatever direct
  coverage of `resolveExecutable` existed only implicitly through `gates.test.ts` before — this
  gives them their own home now that they're a shared, public-to-the-package module.
- `packages/core/test/backends/cli.test.ts`: spawns real `node -e "..."` fixtures (matching
  `gates.test.ts`'s own established style of using real short-lived processes instead of mocking
  subprocess spawning) — covers: prompt reaches the child via stdin and is reflected in stdout,
  `tokensUsed` is always `0`, non-zero exit throws with the captured output, timeout throws naming
  the effective timeout, a missing command throws before any spawn is attempted.
- `packages/core/test/backends/resolve.test.ts` extensions: resolving a role whose provider names a
  `cliBackends` entry returns a working backend; resolving a name present in neither map throws
  naming both sections; resolving a `backends` entry keyed by an unsupported vendor name throws
  clearly instead of silently defaulting to OpenAI.
- `gates.test.ts` re-run unmodified after the extraction (Task in the implementation plan) to prove
  the move changed nothing about gate behavior.

## 12. Out of scope for M3a

- Argv placeholder templating or any per-CLI-tool special output parsing (e.g. Codex's `--json`
  mode) — out of scope per base spec §11 ("Automatic strategy selection").
- Token/cost accounting for CLI-routed roles.
- Wiring a CLI backend into the deep-task lifecycle's `panel`/`review` phase — that phase does not
  exist yet; it is the other half of M3, specified separately.
- Any change to `packages/mcp/src/tools/consult.ts` or `panel.ts` — both already treat `role` and
  the resolved provider as plain strings, so widening `resolveRoleProvider`/`resolveBackend`'s
  types requires no change to either tool.
