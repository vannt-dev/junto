import type { CompleteInput, CompleteResult, ModelBackend } from "./types.js"

const DEFAULT_MODEL = "gpt-5"
const DEFAULT_TIMEOUT_MS = 60_000
const API_URL = "https://api.openai.com/v1/chat/completions"

interface OpenAIResponse {
  choices: { message: { content: string } }[]
  usage: { total_tokens: number }
  model: string
}

export function openaiBackend(apiKey: string): ModelBackend {
  return {
    async complete({ systemPrompt, userPrompt, model, timeoutMs }: CompleteInput): Promise<CompleteResult> {
      const controller = new AbortController()
      const effectiveTimeoutMs = timeoutMs ?? DEFAULT_TIMEOUT_MS
      const timer = setTimeout(() => controller.abort(), effectiveTimeoutMs)
      try {
        const res = await fetch(API_URL, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: model ?? DEFAULT_MODEL,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
          }),
          signal: controller.signal,
        })
        if (!res.ok) {
          throw new Error(`OpenAI API returned ${res.status}: ${await res.text()}`)
        }
        const data = await res.json() as OpenAIResponse
        const first = data.choices[0]
        return {
          text: first?.message.content ?? "",
          tokensUsed: data.usage.total_tokens,
          model: data.model,
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          throw new Error(`OpenAI API call timed out after ${effectiveTimeoutMs}ms.`)
        }
        throw err
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
