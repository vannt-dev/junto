import { z } from "zod"
import { normalizeBaseUrl } from "./backends/openai.js"

export const SCHEMA_VERSION = 1

export const DEFAULT_STALE_IGNORE = ["**/*.md", "docs/**", ".junto/**"]

export class SchemaVersionError extends Error {
  constructor(public found: number, public supported: number) {
    super(
      `This junto file uses schemaVersion ${found}, but this version only supports up to ${supported}. `
      + "Upgrade junto. It will not guess an unknown format.",
    )
    this.name = "SchemaVersionError"
  }
}

function assertVersion(raw: unknown): void {
  const v = (raw as { schemaVersion?: unknown })?.schemaVersion
  if (typeof v === "number" && v > SCHEMA_VERSION) throw new SchemaVersionError(v, SCHEMA_VERSION)
}

export const phaseSchema = z.enum(["brief", "plan", "panel", "build", "review", "verify", "done"])
export const sizeSchema = z.enum(["small", "standard", "deep"])
export const gateStateSchema = z.enum(["pass", "fail", "skipped"])

export const phaseStatusSchema = z.object({
  status: z.enum(["pending", "active", "done"]),
  at: z.string().optional(),
  approvedBy: z.literal("user").optional(),
  /** Digest of plan.md when the user approved it; a different plan.md voids the approval. */
  planSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  step: z.number().int().optional(),
  of: z.number().int().optional(),
})

export const gateStatusSchema = z.object({
  required: z.boolean(),
  verdict: z.string().nullable(),
  stale: z.boolean(),
  invalidationVersion: z.number().int().min(0).optional(),
  failStreak: z.number().int().min(0),
  /** Base branch tip at the last verify; absent without a remote base and on older tasks. */
  base: z.object({ ref: z.string().min(1), commit: z.string().min(1) }).optional(),
})

export const decisionSchema = z.object({ at: z.string(), what: z.string(), why: z.string() })

/** One raise of the task size; `phase` is where the task was, which decides the skipped steps. */
export const sizeChangeSchema = z.object({
  from: sizeSchema,
  to: sizeSchema,
  at: z.string(),
  phase: phaseSchema,
  reason: z.string(),
})

/**
 * The Stop hook's count of turn-end blocks in one phase. Only the hook writes it (task.json is
 * protected), so the model cannot reset the count to keep or skip the reminder.
 */
export const stopGateStateSchema = z.object({
  phase: phaseSchema,
  blocks: z.number().int().min(0),
  /** Digest of the gate evidence at the last block; unchanged evidence means no progress. */
  evidence: z.string(),
  /** Why the hook stopped blocking in this phase; set once and recorded as a decision. */
  released: z.enum(["cap", "stall"]).optional(),
})

export const taskSchema = z.object({
  schemaVersion: z.number().int(),
  id: z.string().min(1),
  title: z.string(),
  size: sizeSchema,
  phase: phaseSchema,
  baseCommit: z.string().nullable(),
  ruleApprovalRequired: z.boolean().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  phases: z.record(z.string(), phaseStatusSchema),
  gates: z.record(z.string(), gateStatusSchema),
  decisions: z.array(decisionSchema),
  /** Absent on tasks whose size never changed, including tasks written by older versions. */
  sizeChanges: z.array(sizeChangeSchema).optional(),
  consults: z.array(z.string()),
  consultTokensUsed: z.number().int().min(0).default(0),
  /** Recorded only by the UserPromptSubmit hook when the user types /junto:abandon. */
  abandonRequest: z.object({ by: z.literal("user"), at: z.string() }).optional(),
  /** Absent until the Stop hook first blocks the end of a turn. */
  stopGate: stopGateStateSchema.optional(),
})

export const reviewSeveritySchema = z.enum(["critical", "high", "medium", "low", "info"])

/**
 * A gate is either a command (default) or a review. Both produce the same verdict evidence and
 * only the real result of the command or reviewer can set the state.
 */
export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Lexical check that a gate cwd is relative and stays inside the project root on every platform.
 * Both separators count, so a config written on POSIX cannot escape when run on Windows.
 * The runner repeats the check on the real path, which also catches links.
 */
export function gateCwdProblem(cwd: string): string | null {
  if (cwd === "" || cwd.includes("\0")) return "must be a non-empty relative path"
  if (/^[\\/]/.test(cwd) || /^[A-Za-z]:/.test(cwd)) return "must be relative to the project root, not absolute"
  let depth = 0
  for (const part of cwd.split(/[\\/]+/)) {
    if (part === "..") depth -= 1
    else if (part !== "" && part !== ".") depth += 1
    if (depth < 0) return "must stay inside the project root"
  }
  return null
}

export const gateSpecSchema = z.object({
  type: z.enum(["command", "review"]).optional(),
  argv: z.array(z.string()).min(1).optional(),
  provider: z.enum(["open-code-review", "cli"]).optional(),
  failOn: z.array(reviewSeveritySchema).min(1).optional(),
  required: z.boolean(),
  timeoutMs: z.number().int().positive().optional(),
  /** Directory the command runs in, relative to the project root. */
  cwd: z.string().optional(),
  /** Merged over the process environment; values may reference `${VAR}` from it. */
  env: z.record(z.string(), z.string()).optional(),
}).superRefine((spec, ctx) => {
  const command = (spec.type ?? "command") === "command"
  if (command && spec.argv === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A command gate requires argv", path: ["argv"] })
  }
  for (const field of ["cwd", "env"] as const) {
    if (!command && spec[field] !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${field} is only supported on a command gate`, path: [field] })
    }
  }
  const cwdProblem = spec.cwd === undefined ? null : gateCwdProblem(spec.cwd)
  if (cwdProblem !== null) ctx.addIssue({ code: z.ZodIssueCode.custom, message: cwdProblem, path: ["cwd"] })
  for (const name of Object.keys(spec.env ?? {})) {
    if (!ENV_NAME.test(name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `"${name}" is not a valid variable name; use letters, digits and "_", not starting with a digit`,
        path: ["env"],
      })
    }
  }
})

export const ruleSpecSchema = z.object({
  id: z.string().min(1),
  match: z.array(z.string().min(1)).min(1),
  skills: z.array(z.string().min(1)).optional(),
  gates: z.array(z.string().min(1)).optional(),
  approvalRequired: z.boolean().optional(),
}).strict()

export const skillsConfigSchema = z.object({
  roots: z.array(z.string().min(1)).default([]),
}).strict()

export const providerSchema = z.enum(["anthropic", "openai"])
export type Provider = z.infer<typeof providerSchema>

export const backendSpecSchema = z.object({
  apiKeyEnv: z.string().min(1),
  model: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
  baseUrl: z.string().min(1).optional(),
}).strict().superRefine((spec, ctx) => {
  if (spec.baseUrl === undefined) return
  try {
    normalizeBaseUrl(spec.baseUrl)
  } catch (error) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: (error as Error).message, path: ["baseUrl"] })
  }
})

export const cliBackendSpecSchema = z.object({
  argv: z.array(z.string()).min(1),
  timeoutMs: z.number().int().positive().optional(),
}).strict()

export const roleSpecSchema = z.object({
  provider: z.string().min(1),
  model: z.string().optional(),
}).strict()

export const consultBudgetSchema = z.object({
  maxTokensPerTask: z.number().int().positive().optional(),
}).strict()

export const consultContextConfigSchema = z.object({
  enabled: z.boolean().default(false),
  maxChars: z.number().int().positive().max(50_000).default(12_000),
  persist: z.boolean().default(true),
}).strict()

export const stopGateConfigSchema = z.object({
  enabled: z.boolean().default(true),
  /** Claude Code itself ends a turn after 8 consecutive stop-hook continuations. */
  maxBlocks: z.number().int().min(1).max(8).default(3),
}).strict()

export const configSchema = z.object({
  schemaVersion: z.number().int(),
  gates: z.record(z.string(), gateSpecSchema),
  staleIgnore: z.array(z.string()).default(DEFAULT_STALE_IGNORE),
  autoApprove: z.array(sizeSchema).default([]),
  backends: z.record(z.string(), backendSpecSchema).optional(),
  cliBackends: z.record(z.string(), cliBackendSpecSchema).optional(),
  roles: z.record(z.string(), roleSpecSchema).optional(),
  consultBudget: consultBudgetSchema.optional(),
  consultContext: consultContextConfigSchema.optional(),
  rules: z.array(ruleSpecSchema).optional(),
  skills: skillsConfigSchema.optional(),
  stopGate: stopGateConfigSchema.optional(),
}).passthrough().superRefine((config, ctx) => {
  const seen = new Set<string>()
  for (const [index, rule] of (config.rules ?? []).entries()) {
    if (seen.has(rule.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate rule id "${rule.id}"`, path: ["rules", index, "id"] })
    }
    seen.add(rule.id)
  }
})

export type Phase = z.infer<typeof phaseSchema>
export type Size = z.infer<typeof sizeSchema>
export type GateState = z.infer<typeof gateStateSchema>
export type PhaseStatus = z.infer<typeof phaseStatusSchema>
export type GateStatus = z.infer<typeof gateStatusSchema>
export type Decision = z.infer<typeof decisionSchema>
export type SizeChange = z.infer<typeof sizeChangeSchema>
export type StopGateState = z.infer<typeof stopGateStateSchema>
export type StopGateConfig = z.infer<typeof stopGateConfigSchema>
export type Task = z.infer<typeof taskSchema>
export type GateSpec = z.infer<typeof gateSpecSchema>
export type RuleSpec = z.infer<typeof ruleSpecSchema>
export type SkillsConfig = z.infer<typeof skillsConfigSchema>
export type BackendSpec = z.infer<typeof backendSpecSchema>
export type CliBackendSpec = z.infer<typeof cliBackendSpecSchema>
export type RoleSpec = z.infer<typeof roleSpecSchema>
export type ConsultBudget = z.infer<typeof consultBudgetSchema>
export type ConsultContextConfig = z.infer<typeof consultContextConfigSchema>
export type Config = z.infer<typeof configSchema>

export interface VerdictFile {
  schemaVersion: number
  gate: string
  argv: string[]
  cwd: string
  exitCode: number | null
  state: GateState
  startedAt: string
  durationMs: number
  outputTail: string
  outputBytes: number
  outputFile: string
  runner: string
  /** Names of the variables the gate's `env` set, sorted; values are never recorded. */
  envKeys?: string[]
  reason?: string
  /** Present on source-bound reviews; legacy reviews must be rerun. */
  reviewFingerprint?: string
  /** Present on command gates run in a Git repository root; binds the verdict to source contents. */
  sourceFingerprint?: string
}

export function parseTask(raw: unknown): Task {
  assertVersion(raw)
  return taskSchema.parse(raw)
}

function issueLine(issue: z.ZodIssue): string {
  return `- ${issue.path.join(".") || "(root)"}: ${issue.message}`
}

/** Lists each problem by its config path. Messages never quote config values, which may be secrets. */
export class ConfigError extends Error {
  constructor(public issues: z.ZodIssue[]) {
    super(`Invalid .junto/config.json:\n${issues.map(issueLine).join("\n")}`)
    this.name = "ConfigError"
  }
}

export function parseConfig(raw: unknown): Config {
  assertVersion(raw)
  const result = configSchema.safeParse(raw)
  if (!result.success) throw new ConfigError(result.error.issues)
  return result.data
}
