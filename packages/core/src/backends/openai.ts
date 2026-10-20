import type { CompleteInput, CompleteResult, ModelBackend } from "./types.js"

const DEFAULT_MODEL = "gpt-5"
const DEFAULT_TIMEOUT_MS = 60_000
export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1"

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

interface OpenAIResponse {
  choices: { message: { content: string | null } }[]
  usage?: { total_tokens?: number }
  model?: string
}

export interface OpenAIBackendOptions {
  /** Any OpenAI-compatible chat completions endpoint, e.g. `http://localhost:11434/v1`. */
  baseUrl?: string
}

/**
 * Validates an OpenAI-compatible base URL and strips trailing slashes. The request path is
 * appended to it, so a query string or fragment would end up in the wrong place, and
 * embedded credentials would be persisted in config and echoed in error messages.
 */
export function normalizeBaseUrl(raw: string, label = "baseUrl"): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`${label} "${raw}" is not a valid URL. Use an http(s) URL such as https://openrouter.ai/api/v1.`)
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label} must use http or https, not "${url.protocol}".`)
  }
  if (url.username !== "" || url.password !== "") {
    throw new Error(`${label} must not contain credentials. Put the key in the environment variable named by apiKeyEnv.`)
  }
  if (url.search !== "" || url.hash !== "") {
    throw new Error(`${label} must not contain a query string or fragment.`)
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "")
}

/** Local servers such as Ollama and LM Studio accept requests without a key. */
export function isLoopbackUrl(raw: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(raw).hostname)
  } catch {
    return false
  }
}

export function openaiBackend(apiKey: string | undefined, options: OpenAIBackendOptions = {}): ModelBackend {
  const baseUrl = options.baseUrl === undefined ? DEFAULT_OPENAI_BASE_URL : normalizeBaseUrl(options.baseUrl)
  // Chat completions, not the Responses API: it is the endpoint OpenAI-compatible servers implement.
  const apiUrl = `${baseUrl}/chat/completions`
  const label = baseUrl === DEFAULT_OPENAI_BASE_URL ? "OpenAI API" : `OpenAI-compatible API at ${new URL(baseUrl).host}`
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (apiKey !== undefined && apiKey !== "") headers.Authorization = `Bearer ${apiKey}`

  return {
    async complete({ systemPrompt, userPrompt, model, timeoutMs }: CompleteInput): Promise<CompleteResult> {
      const controller = new AbortController()
      const effectiveTimeoutMs = timeoutMs ?? DEFAULT_TIMEOUT_MS
      const timer = setTimeout(() => controller.abort(), effectiveTimeoutMs)
      const requestedModel = model ?? DEFAULT_MODEL
      try {
        const res = await fetch(apiUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: requestedModel,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
          }),
          signal: controller.signal,
        })
        if (!res.ok) {
          throw new Error(`${label} returned ${res.status}: ${await res.text()}`)
        }
        const data = await res.json() as OpenAIResponse
        const first = data.choices[0]
        // Some compatible servers omit usage or model; such calls count as zero tokens.
        return {
          text: first?.message.content ?? "",
          tokensUsed: data.usage?.total_tokens ?? 0,
          model: data.model ?? requestedModel,
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          throw new Error(`${label} call timed out after ${effectiveTimeoutMs}ms.`)
        }
        throw err
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
