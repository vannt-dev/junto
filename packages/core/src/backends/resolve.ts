import { anthropicBackend } from "./anthropic.js"
import { openaiBackend } from "./openai.js"
import { DEFAULT_ROLE_PROVIDER, isBuiltInRole } from "./roles.js"
import type { ModelBackend } from "./types.js"
import type { Config, Provider } from "../schema.js"

export function resolveRoleProvider(role: string, config: Config): Provider {
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

export function resolveBackend(provider: Provider, config: Config): ResolvedBackend {
  const spec = config.backends?.[provider]
  if (spec === undefined) {
    throw new Error(
      `No "${provider}" entry under "backends" in .junto/config.json. `
      + `Add { "backends": { "${provider}": { "apiKeyEnv": "..." } } }.`,
    )
  }
  const apiKey = process.env[spec.apiKeyEnv]
  if (apiKey === undefined || apiKey === "") {
    throw new Error(
      `Environment variable "${spec.apiKeyEnv}" is not set (required by backends.${provider}.apiKeyEnv `
      + "in .junto/config.json).",
    )
  }
  const backend = provider === "anthropic" ? anthropicBackend(apiKey) : openaiBackend(apiKey)
  return { backend, model: spec.model, timeoutMs: spec.timeoutMs }
}
