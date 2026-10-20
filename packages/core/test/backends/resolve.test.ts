import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { resolveBackend, resolveRoleProvider } from "../../src/backends/resolve.js"
import type { Config } from "../../src/schema.js"

const baseConfig: Config = { schemaVersion: 1, gates: {}, staleIgnore: [], autoApprove: [] }

describe("resolveRoleProvider", () => {
  it("uses the built-in default for a known role with no config override", () => {
    expect(resolveRoleProvider("adversary", baseConfig)).toBe("openai")
    expect(resolveRoleProvider("architect", baseConfig)).toBe("anthropic")
  })

  it("uses a config override when present", () => {
    const config: Config = { ...baseConfig, roles: { adversary: { provider: "anthropic" } } }
    expect(resolveRoleProvider("adversary", config)).toBe("anthropic")
  })

  it("throws for a custom role with no config entry", () => {
    expect(() => resolveRoleProvider("philosopher", baseConfig)).toThrow(/no provider/i)
  })
})

describe("resolveBackend", () => {
  afterEach(() => { delete process.env.JUNTO_TEST_KEY })

  it("throws when the backend has no entry in config.json", () => {
    expect(() => resolveBackend("anthropic", baseConfig, "/tmp/does-not-need-to-exist")).toThrow(/no "anthropic" entry/i)
  })

  it("throws naming the env var, and never a key value, when it is unset", () => {
    const config: Config = { ...baseConfig, backends: { anthropic: { apiKeyEnv: "JUNTO_TEST_KEY" } } }
    expect(() => resolveBackend("anthropic", config, "/tmp/does-not-need-to-exist")).toThrow(/JUNTO_TEST_KEY/)
  })

  it("resolves a usable backend once the env var is set", () => {
    process.env.JUNTO_TEST_KEY = "sk-test"
    const config: Config = {
      ...baseConfig,
      backends: { anthropic: { apiKeyEnv: "JUNTO_TEST_KEY", model: "m", timeoutMs: 9000 } },
    }
    const resolved = resolveBackend("anthropic", config, "/tmp/does-not-need-to-exist")
    expect(resolved.model).toBe("m")
    expect(resolved.timeoutMs).toBe(9000)
    expect(typeof resolved.backend.complete).toBe("function")
  })
})

describe("resolveBackend — cliBackends", () => {
  afterEach(() => { delete process.env.JUNTO_TEST_KEY })

  it("resolves a role whose provider names a cliBackends entry", () => {
    const config: Config = {
      ...baseConfig,
      cliBackends: { codex: { argv: ["node", "-e", "process.exit(0)"] } },
    }
    const resolved = resolveBackend("codex", config, "/tmp/does-not-need-to-exist")
    expect(typeof resolved.backend.complete).toBe("function")
  })

  it("checks backends before cliBackends", () => {
    process.env.JUNTO_TEST_KEY = "sk-test"
    const config: Config = {
      ...baseConfig,
      backends: { dual: { apiKeyEnv: "JUNTO_TEST_KEY" } },
      cliBackends: { dual: { argv: ["node", "-e", "process.exit(0)"] } },
    }
    expect(() => resolveBackend("dual", config, "/tmp/does-not-need-to-exist")).toThrow(/not a supported api vendor/i)
  })

  it("throws naming both config sections when a name is in neither", () => {
    expect(() => resolveBackend("nonexistent", baseConfig, "/tmp/does-not-need-to-exist"))
      .toThrow(/backends.*cliBackends|cliBackends.*backends/is)
  })

  it("throws clearly for a backends entry keyed by an unsupported vendor name, without falling through to openai", () => {
    process.env.JUNTO_TEST_KEY = "sk-test"
    const config: Config = { ...baseConfig, backends: { cohere: { apiKeyEnv: "JUNTO_TEST_KEY" } } }
    expect(() => resolveBackend("cohere", config, "/tmp/does-not-need-to-exist")).toThrow(/not a supported api vendor/i)
  })
})

describe("resolveBackend — OpenAI-compatible baseUrl", () => {
  // A developer's shell may export the override; these tests must not inherit it.
  beforeEach(() => { delete process.env.JUNTO_OPENAI_BASE_URL })
  afterEach(() => {
    delete process.env.JUNTO_TEST_KEY
    delete process.env.JUNTO_OPENAI_BASE_URL
    vi.unstubAllGlobals()
  })

  const chatOk = () => vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content: "ok" } }], usage: { total_tokens: 1 }, model: "m" }),
  })

  async function calledUrl(config: Config): Promise<{ url: string, headers: Record<string, string> }> {
    const fetchMock = chatOk()
    vi.stubGlobal("fetch", fetchMock)
    await resolveBackend("openai", config, "/tmp/x").backend.complete({ systemPrompt: "s", userPrompt: "u" })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    return { url, headers: init.headers as Record<string, string> }
  }

  it("uses the configured baseUrl", async () => {
    process.env.JUNTO_TEST_KEY = "sk-test"
    const config: Config = {
      ...baseConfig,
      backends: { openai: { apiKeyEnv: "JUNTO_TEST_KEY", baseUrl: "https://openrouter.ai/api/v1/" } },
    }
    const { url, headers } = await calledUrl(config)
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions")
    expect(headers.Authorization).toBe("Bearer sk-test")
  })

  it("keeps api.openai.com when no baseUrl is set", async () => {
    process.env.JUNTO_TEST_KEY = "sk-test"
    const config: Config = { ...baseConfig, backends: { openai: { apiKeyEnv: "JUNTO_TEST_KEY" } } }
    expect((await calledUrl(config)).url).toBe("https://api.openai.com/v1/chat/completions")
  })

  it("lets JUNTO_OPENAI_BASE_URL override the configured baseUrl", async () => {
    process.env.JUNTO_TEST_KEY = "sk-test"
    process.env.JUNTO_OPENAI_BASE_URL = "http://localhost:1234/v1"
    const config: Config = {
      ...baseConfig,
      backends: { openai: { apiKeyEnv: "JUNTO_TEST_KEY", baseUrl: "https://openrouter.ai/api/v1" } },
    }
    expect((await calledUrl(config)).url).toBe("http://localhost:1234/v1/chat/completions")
  })

  it("resolves a local server without a key and sends no Authorization header", async () => {
    const config: Config = {
      ...baseConfig,
      backends: { openai: { apiKeyEnv: "JUNTO_TEST_KEY", baseUrl: "http://localhost:11434/v1" } },
    }
    const { url, headers } = await calledUrl(config)
    expect(url).toBe("http://localhost:11434/v1/chat/completions")
    expect(Object.keys(headers).map(h => h.toLowerCase())).not.toContain("authorization")
  })

  it("still requires the key for a remote baseUrl", () => {
    const config: Config = {
      ...baseConfig,
      backends: { openai: { apiKeyEnv: "JUNTO_TEST_KEY", baseUrl: "https://openrouter.ai/api/v1" } },
    }
    expect(() => resolveBackend("openai", config, "/tmp/x")).toThrow(/JUNTO_TEST_KEY/)
  })

  it("rejects a non-http(s) JUNTO_OPENAI_BASE_URL, naming the variable", () => {
    process.env.JUNTO_TEST_KEY = "sk-test"
    process.env.JUNTO_OPENAI_BASE_URL = "file:///etc/passwd"
    const config: Config = { ...baseConfig, backends: { openai: { apiKeyEnv: "JUNTO_TEST_KEY" } } }
    expect(() => resolveBackend("openai", config, "/tmp/x")).toThrow(/JUNTO_OPENAI_BASE_URL.*http/is)
  })

  it("rejects baseUrl on the anthropic backend", () => {
    process.env.JUNTO_TEST_KEY = "sk-test"
    const config: Config = {
      ...baseConfig,
      backends: { anthropic: { apiKeyEnv: "JUNTO_TEST_KEY", baseUrl: "https://example.com/v1" } },
    }
    expect(() => resolveBackend("anthropic", config, "/tmp/x")).toThrow(/baseUrl.*openai/i)
  })
})
