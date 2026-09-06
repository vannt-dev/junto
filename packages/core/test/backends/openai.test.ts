import { afterEach, describe, expect, it, vi } from "vitest"
import { openaiBackend } from "../../src/backends/openai.js"

afterEach(() => { vi.unstubAllGlobals() })

describe("openaiBackend", () => {
  it("parses text and total token usage from a successful response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "looks solid" } }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        model: "gpt-5",
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const backend = openaiBackend("test-key")
    const result = await backend.complete({ systemPrompt: "sys", userPrompt: "hi" })

    expect(result).toEqual({ text: "looks solid", tokensUsed: 150, model: "gpt-5" })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.openai.com/v1/chat/completions")
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key")
    const body = JSON.parse(init.body as string) as { messages: { role: string, content: string }[] }
    expect(body.messages[0]).toEqual({ role: "system", content: "sys" })
    expect(body.messages[1]).toEqual({ role: "user", content: "hi" })
  })

  it("throws with the status and body on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "server error" }))
    await expect(openaiBackend("key").complete({ systemPrompt: "s", userPrompt: "u" }))
      .rejects.toThrow(/500/)
  })

  it("times out and throws a clear message instead of hanging", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => {
        const err = new Error("aborted")
        err.name = "AbortError"
        reject(err)
      })
    })))
    await expect(
      openaiBackend("key").complete({ systemPrompt: "s", userPrompt: "u", timeoutMs: 10 }),
    ).rejects.toThrow(/timed out after 10ms/i)
  })
})
