import { anthropicBackend } from "./anthropic.js"
import { cliBackend } from "./cli.js"
import { isLoopbackUrl, normalizeBaseUrl, openaiBackend } from "./openai.js"
import { DEFAULT_ROLE_PROVIDER, isBuiltInRole } from "./roles.js"
import type { ModelBackend } from "./types.js"
import type { Config } from "../schema.js"

export function resolveRoleProvider(role: string, config: Config): string {
  const configured = config.roles?.[role]?.provider
  if (configured !== undefined) return configured
  if (isBuiltInRole(role)) return DEFAULT_ROLE_PROVIDER[role]
  throw new Error(
    `Role "${role}" has no provider. Add roles: { "${role}": { "provider": "<name>" } } to `
    + ".junto/config.json, naming an entry under \"backends\" or \"cliBackends\".",
  )
}

export interface ResolvedBackend {
  backend: ModelBackend
  model?: string
  timeoutMs?: number
}

export function resolveBackend(name: string, config: Config, root: string): ResolvedBackend {
  const apiSpec = config.backends?.[name]
  if (apiSpec !== undefined) {
    if (name !== "anthropic" && name !== "openai") {
      throw new Error(`"${name}" under "backends" is not a supported API vendor (only "anthropic" and "openai" are).`)
    }
    if (name === "anthropic" && apiSpec.baseUrl !== undefined) {
      throw new Error("backends.anthropic.baseUrl is not supported; baseUrl applies only to backends.openai.")
    }
    const baseUrl = name === "openai" ? openaiBaseUrl(apiSpec.baseUrl) : undefined
    const apiKey = process.env[apiSpec.apiKeyEnv]
    const keyMissing = apiKey === undefined || apiKey === ""
    // Local OpenAI-compatible servers (Ollama, LM Studio) take no key; remote endpoints always need one.
    if (keyMissing && !(baseUrl !== undefined && isLoopbackUrl(baseUrl))) {
      throw new Error(
        `Environment variable "${apiSpec.apiKeyEnv}" is not set (required by backends.${name}.apiKeyEnv `
        + "in .junto/config.json).",
      )
    }
    return name === "anthropic"
      ? { backend: anthropicBackend(apiKey ?? ""), model: apiSpec.model, timeoutMs: apiSpec.timeoutMs }
      : { backend: openaiBackend(apiKey, { baseUrl }), model: apiSpec.model, timeoutMs: apiSpec.timeoutMs }
  }

  const cliSpec = config.cliBackends?.[name]
  if (cliSpec !== undefined) {
    return { backend: cliBackend(cliSpec.argv, root), timeoutMs: cliSpec.timeoutMs }
  }

  throw new Error(
    `No "${name}" entry under "backends" or "cliBackends" in .junto/config.json. `
    + `Add one under "backends" (API vendor) or "cliBackends" (spawned CLI tool).`,
  )
}

/** `JUNTO_OPENAI_BASE_URL` wins over config so one machine can point at a local server. */
function openaiBaseUrl(configured: string | undefined): string | undefined {
  const fromEnv = process.env.JUNTO_OPENAI_BASE_URL
  if (fromEnv !== undefined && fromEnv !== "") return normalizeBaseUrl(fromEnv, "JUNTO_OPENAI_BASE_URL")
  return configured === undefined ? undefined : normalizeBaseUrl(configured, "backends.openai.baseUrl")
}
