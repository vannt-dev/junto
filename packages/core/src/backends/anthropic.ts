import type { CompleteInput, CompleteResult, ModelBackend } from "./types.js"

const DEFAULT_MODEL = "claude-sonnet-5"
const DEFAULT_MAX_TOKENS = 4096
const DEFAULT_TIMEOUT_MS = 60_000
const API_URL = "https://api.anthropic.com/v1/messages"

interface AnthropicResponse {
  content: { type: string, text?: string }[]
  usage: { input_tokens: number, output_tokens: number }
  model: string
}

export function anthropicBackend(apiKey: string): ModelBackend {
  return {
    async complete({ systemPrompt, userPrompt, model, timeoutMs }: CompleteInput): Promise<CompleteResult> {
      const controller = new AbortController()
      const effectiveTimeoutMs = timeoutMs ?? DEFAULT_TIMEOUT_MS
      const timer = setTimeout(() => controller.abort(), effectiveTimeoutMs)
      try {
        const res = await fetch(API_URL, {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: model ?? DEFAULT_MODEL,
            max_tokens: DEFAULT_MAX_TOKENS,
            system: systemPrompt,
            messages: [{ role: "user", content: userPrompt }],
          }),
          signal: controller.signal,
        })
        if (!res.ok) {
          throw new Error(`Anthropic API returned ${res.status}: ${await res.text()}`)
        }
        const data = await res.json() as AnthropicResponse
        const text = data.content.filter(b => b.type === "text").map(b => b.text ?? "").join("")
        return { text, tokensUsed: data.usage.input_tokens + data.usage.output_tokens, model: data.model }
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          throw new Error(`Anthropic API call timed out after ${effectiveTimeoutMs}ms.`)
        }
        throw err
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
