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
