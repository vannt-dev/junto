import { z } from "zod"

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
  step: z.number().int().optional(),
  of: z.number().int().optional(),
})

export const gateStatusSchema = z.object({
  required: z.boolean(),
  verdict: z.string().nullable(),
  stale: z.boolean(),
  failStreak: z.number().int().min(0),
})

export const decisionSchema = z.object({ at: z.string(), what: z.string(), why: z.string() })

export const taskSchema = z.object({
  schemaVersion: z.number().int(),
  id: z.string().min(1),
  title: z.string(),
  size: sizeSchema,
  phase: phaseSchema,
  baseCommit: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  phases: z.record(z.string(), phaseStatusSchema),
  gates: z.record(z.string(), gateStatusSchema),
  decisions: z.array(decisionSchema),
  consults: z.array(z.string()),
  consultTokensUsed: z.number().int().min(0).default(0),
})

export const gateSpecSchema = z.object({
  argv: z.array(z.string()).min(1),
  required: z.boolean(),
  timeoutMs: z.number().int().positive().optional(),
})

export const providerSchema = z.enum(["anthropic", "openai"])
export type Provider = z.infer<typeof providerSchema>

export const backendSpecSchema = z.object({
  apiKeyEnv: z.string().min(1),
  model: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
}).strict()

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
}).passthrough()

export type Phase = z.infer<typeof phaseSchema>
export type Size = z.infer<typeof sizeSchema>
export type GateState = z.infer<typeof gateStateSchema>
export type PhaseStatus = z.infer<typeof phaseStatusSchema>
export type GateStatus = z.infer<typeof gateStatusSchema>
export type Decision = z.infer<typeof decisionSchema>
export type Task = z.infer<typeof taskSchema>
export type GateSpec = z.infer<typeof gateSpecSchema>
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
  reason?: string
}

export function parseTask(raw: unknown): Task {
  assertVersion(raw)
  return taskSchema.parse(raw)
}

export function parseConfig(raw: unknown): Config {
  assertVersion(raw)
  return configSchema.parse(raw)
}
