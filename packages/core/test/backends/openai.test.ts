import { afterEach, describe, expect, it, vi } from "vitest"
import { isLoopbackUrl, normalizeBaseUrl, openaiBackend } from "../../src/backends/openai.js"

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
      const completePromise = openaiBackend("key").complete({ systemPrompt: "s", userPrompt: "u" })
      const assertion = expect(completePromise).rejects.toThrow(/timed out after 60000ms/i)
      await vi.advanceTimersByTimeAsync(60_000)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("openaiBackend — OpenAI-compatible endpoints", () => {
  const okResponse = (body: unknown) => vi.fn().mockResolvedValue({ ok: true, json: async () => body })
  const chatBody = { choices: [{ message: { content: "ok" } }], usage: { total_tokens: 7 }, model: "llama3.1" }

  it("posts chat completions relative to a custom baseUrl, normalising trailing slashes", async () => {
    const fetchMock = okResponse(chatBody)
    vi.stubGlobal("fetch", fetchMock)
    const backend = openaiBackend("k", { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai//" })
    await backend.complete({ systemPrompt: "s", userPrompt: "u", model: "gemini-2.5-flash" })
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions")
  })

  it("sends no Authorization header when no key is given", async () => {
    const fetchMock = okResponse(chatBody)
    vi.stubGlobal("fetch", fetchMock)
    await openaiBackend(undefined, { baseUrl: "http://localhost:11434/v1" })
      .complete({ systemPrompt: "s", userPrompt: "u", model: "llama3.1" })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("http://localhost:11434/v1/chat/completions")
    const headers = init.headers as Record<string, string>
    expect(Object.keys(headers).map(h => h.toLowerCase())).not.toContain("authorization")
  })

  it("sends no Authorization header for an empty key", async () => {
    const fetchMock = okResponse(chatBody)
    vi.stubGlobal("fetch", fetchMock)
    await openaiBackend("", { baseUrl: "http://127.0.0.1:1234/v1" }).complete({ systemPrompt: "s", userPrompt: "u" })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(Object.keys(init.headers as Record<string, string>).map(h => h.toLowerCase())).not.toContain("authorization")
  })

  it("tolerates a server that omits usage and model", async () => {
    vi.stubGlobal("fetch", okResponse({ choices: [{ message: { content: "hi" } }] }))
    const result = await openaiBackend(undefined, { baseUrl: "http://localhost:1234/v1" })
      .complete({ systemPrompt: "s", userPrompt: "u", model: "qwen3" })
    expect(result).toEqual({ text: "hi", tokensUsed: 0, model: "qwen3" })
  })

  it("names the custom endpoint, never the key, in an error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "unauthorized" }))
    const call = openaiBackend("sk-secret-value", { baseUrl: "https://openrouter.ai/api/v1" })
      .complete({ systemPrompt: "s", userPrompt: "u" })
    await expect(call).rejects.toThrow(/OpenAI-compatible API at openrouter\.ai returned 401/)
    await expect(call).rejects.not.toThrow(/sk-secret-value/)
  })

  it("rejects a non-http(s) baseUrl", () => {
    expect(() => openaiBackend("k", { baseUrl: "ftp://example.com/v1" })).toThrow(/http/i)
    expect(() => openaiBackend("k", { baseUrl: "not a url" })).toThrow(/baseUrl/i)
  })
})

describe("normalizeBaseUrl", () => {
  it("strips trailing slashes and keeps the path", () => {
    expect(normalizeBaseUrl("https://openrouter.ai/api/v1/")).toBe("https://openrouter.ai/api/v1")
    expect(normalizeBaseUrl("http://localhost:11434/v1")).toBe("http://localhost:11434/v1")
  })

  it("rejects credentials, query strings and fragments", () => {
    expect(() => normalizeBaseUrl("https://user:pass@example.com/v1")).toThrow(/credentials/i)
    expect(() => normalizeBaseUrl("https://example.com/v1?x=1")).toThrow(/query|fragment/i)
    expect(() => normalizeBaseUrl("https://example.com/v1#x")).toThrow(/query|fragment/i)
  })
})

describe("isLoopbackUrl", () => {
  it("accepts localhost, 127.0.0.1 and ::1 only", () => {
    expect(isLoopbackUrl("http://localhost:11434/v1")).toBe(true)
    expect(isLoopbackUrl("http://127.0.0.1:1234/v1")).toBe(true)
    expect(isLoopbackUrl("http://[::1]:1234/v1")).toBe(true)
    expect(isLoopbackUrl("https://openrouter.ai/api/v1")).toBe(false)
    expect(isLoopbackUrl("http://localhost.example.com/v1")).toBe(false)
  })
})
