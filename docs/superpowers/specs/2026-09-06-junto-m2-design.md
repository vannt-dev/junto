# junto M2 design — advisory multi-model consult/panel

- Date: 2026-09-06
- Status: Approved
- Depends on: `docs/superpowers/specs/2026-08-30-junto-design.md` (base design; still authoritative for R1-R5 and everything not restated here)

## 1. Purpose

M2 adds advisory, multi-provider model consultation to junto: a single-role `consult` tool, a
multi-role `panel` tool, a role system, and a per-task token budget. All of it is advisory — see
Invariants. M3 (a separate spec) will wire `panel` into the `deep` task's phase list; M2 does not
touch `packages/core/src/transitions.ts`.

## 2. Invariants

No changes to R1-R5 in the base spec. Two clarifications specific to M2:

- **R3** applies to backend credentials: `config.json` stores only the *name* of an environment
  variable holding an API key (`apiKeyEnv`), never the key value. The key is read from
  `process.env` at call time and is never written to disk or logged.
- **R5** applies to the plan→build advisory nudge (section 7): it is text in a tool response, not
  a rule in `canEnter()`.

## 3. Providers

M2 ships two backends: Anthropic (Messages API) and OpenAI (Chat Completions API). Both implement
a shared interface in `packages/core/src/backends/types.ts`:

```ts
interface ModelBackend {
  complete(input: {
    systemPrompt: string;
    userPrompt: string;
    model?: string;
    timeoutMs?: number;
  }): Promise<{ text: string; tokensUsed: number; model: string }>;
}
```

Adding a third provider later means adding one file implementing this interface; no other module
changes.

## 4. Roles

Four built-in roles ship as prompt-string constants in `packages/core/src/backends/roles.ts`:
`architect`, `adversary`, `pragmatist`, `reviewer`. Default provider mapping is chosen so
`adversary` is deliberately not the same vendor as the others, to avoid one vendor's blind spots
reviewing its own output:

| role | default provider |
|---|---|
| architect | anthropic |
| adversary | openai |
| pragmatist | anthropic |
| reviewer | anthropic |

A project may override any built-in role's prompt by placing `.junto/roles/<role>.md` on disk — if
present, its contents replace the built-in prompt. A project may also declare additional custom
role names entirely via `config.json`; a custom role with no built-in prompt and no
`.junto/roles/<name>.md` file is a configuration error at consult time, not a silent fallback.

Provider/model per role can be overridden in `config.json`:

```json
{
  "backends": {
    "anthropic": { "apiKeyEnv": "ANTHROPIC_API_KEY", "model": "claude-sonnet-5", "timeoutMs": 60000 },
    "openai":    { "apiKeyEnv": "OPENAI_API_KEY", "model": "gpt-5", "timeoutMs": 60000 }
  },
  "roles": {
    "adversary": { "provider": "openai" }
  },
  "consultBudget": { "maxTokensPerTask": 200000 }
}
```

## 5. On-disk state additions

```text
.junto/
|-- roles/<role>.md            # optional, project overrides of built-in role prompts
`-- tasks/<id>/
    `-- consults/NNN-<role>.md # one file per consult call; NNN is a per-task monotonic sequence
```

`consults/NNN-<role>.md` format:

```markdown
---
role: architect
provider: anthropic
model: claude-sonnet-5
tokensUsed: 1234
createdAt: 2026-09-06T12:00:00.000Z
---

## Question

<question text>

## Response

<model response text>
```

No `schemaVersion` field — these files are free-form evidence like `brief.md`/`plan.md`, not
machine-parsed state, consistent with junto's existing non-JSON task files.

`task.json` gains one field: `consultTokensUsed: number` (default `0`), the running total of
tokens actually reported by provider responses for this task, across both `consult` and `panel`
calls.

## 6. MCP tools

### `junto__consult`

Input: `{ role: string; question: string }`.

Behavior:

1. Requires an active task (`readActiveId`); no active task is a clear error, not a crash.
2. Resolves the role's prompt (built-in constant, or `.junto/roles/<role>.md` if present) and
   provider/model (config override, else the built-in default for the four known roles; an
   unknown role with no config entry is an error).
3. Budget check: if `task.consultTokensUsed >= consultBudget.maxTokensPerTask`, refuse before
   making any network call, with a message naming the current usage and the cap.
4. Reads `brief.md` and `plan.md` of the active task (missing files are treated as empty context,
   not an error).
5. Calls the resolved backend with a timeout (`backends.<provider>.timeoutMs`, default 60000ms).
6. On success: writes `consults/NNN-<role>.md`, updates `task.consultTokensUsed` via `updateTask`
   (the existing short-lived lock), and returns a terse result
   `{ path, tokensUsed, consultTokensUsedTotal }`.
7. On failure (missing env var, non-2xx response, timeout, network error): writes nothing, spends
   no budget, and returns a clear terse error. Consult failures are never gates — they never block
   any phase transition.

### `junto__panel`

Input: `{ roles?: string[]; question: string }`. `roles` defaults to the four built-in roles if
omitted.

Behavior: calls `consult()` for each role via `Promise.allSettled` — one provider's failure never
fails the others. Budget is shared and cumulative across the roles in one panel call: once
`consultTokensUsed` reaches the cap partway through, the remaining roles are skipped (no network
call, no file written) and reported as skipped in the result, alongside the roles that succeeded
or failed. No aggregate/summary file is produced — every role's output stands on its own.

## 7. Advisory nudge at plan→build

When `junto__advance` succeeds in moving a task with `size: "deep"` to phase `build`, its response
text includes a suggestion to run `/junto:panel` before proceeding. This is pure text in the
tool's response — `transitions.ts` and `canEnter()` are unchanged, and nothing about this phase
transition is blocked by the presence or absence of any consult/panel file. M3 is expected to turn
this into an actual `panel` phase in the `deep` lifecycle; M2 only adds the capability and the
reminder.

## 8. Error handling summary

| condition | outcome |
|---|---|
| no active task | consult/panel refuse, clear message |
| unknown role, no config entry, no `.junto/roles/<role>.md` | refuse, clear message |
| `apiKeyEnv` not set in `process.env` | refuse before any request, clear message naming the env var (never its value) |
| budget already at/over cap | refuse before any request |
| network error / timeout / non-2xx | no file written, no budget spent, terse error returned; never blocks a phase |

## 9. Testing

- `packages/core/test/backends/anthropic.test.ts`, `openai.test.ts`: mock global `fetch`; verify
  request shape, correct token-usage parsing per provider's response shape, timeout abort.
- `packages/core/test/backends/roles.test.ts`: built-in default, `.junto/roles/` override, unknown
  role error.
- `packages/mcp/test/consult-tool.test.ts`, `panel-tool.test.ts`: no active task, budget refusal,
  one role failing does not fail the panel, successful file output shape.
- `test/boundary.test.ts` extension: `configSchema` rejects any field carrying a literal key value
  (only `*Env`-suffixed fields accepted) — enforces R3 at the schema/type level, not only by
  review.

## 10. Out of scope for M2

- Wiring `panel` into the `deep` task's phase list (`transitions.ts`) — M3.
- CLI-spawned backends (Codex CLI, Gemini CLI, etc.) — M3.
- Any model opinion becoming a gate, ever — permanently out of scope per base spec R5.
- Aggregate/consensus summarization of a panel's results.
- A third API provider — the adapter interface supports it; adding one is a future increment, not
  part of this spec.
