import { afterEach, describe, expect, it, vi } from "vitest"
import { anthropicBackend } from "../../src/backends/anthropic.js"

afterEach(() => { vi.unstubAllGlobals() })

describe("anthropicBackend", () => {
  it("parses text and total token usage from a successful response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: "looks solid" }],
        usage: { input_tokens: 100, output_tokens: 50 },
        model: "claude-sonnet-5",
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const backend = anthropicBackend("test-key")
    const result = await backend.complete({ systemPrompt: "sys", userPrompt: "hi" })

    expect(result).toEqual({ text: "looks solid", tokensUsed: 150, model: "claude-sonnet-5" })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.anthropic.com/v1/messages")
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("test-key")
    const body = JSON.parse(init.body as string) as { system: string, messages: unknown }
    expect(body.system).toBe("sys")
  })

  it("joins multiple text content blocks", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: "part one. " }, { type: "text", text: "part two." }],
        usage: { input_tokens: 1, output_tokens: 1 },
        model: "claude-sonnet-5",
      }),
    }))
    const result = await anthropicBackend("key").complete({ systemPrompt: "s", userPrompt: "u" })
    expect(result.text).toBe("part one. part two.")
  })

  it("throws with the status and body on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "unauthorized" }))
    await expect(anthropicBackend("bad-key").complete({ systemPrompt: "s", userPrompt: "u" }))
      .rejects.toThrow(/401/)
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
      anthropicBackend("key").complete({ systemPrompt: "s", userPrompt: "u", timeoutMs: 10 }),
    ).rejects.toThrow(/timed out after 10ms/i)
  })

  it("times out using the default even when timeoutMs is omitted", async () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const err = new Error("aborted")
          err.name = "AbortError"
          reject(err)
        })
      })))
      const completePromise = anthropicBackend("key").complete({ systemPrompt: "s", userPrompt: "u" })
      const assertion = expect(completePromise).rejects.toThrow(/timed out after 60000ms/i)
      await vi.advanceTimersByTimeAsync(60_000)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })
})
