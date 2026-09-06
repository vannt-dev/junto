import { afterEach, describe, expect, it } from "vitest"
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
    expect(() => resolveBackend("anthropic", baseConfig)).toThrow(/no "anthropic" entry/i)
  })

  it("throws naming the env var, and never a key value, when it is unset", () => {
    const config: Config = { ...baseConfig, backends: { anthropic: { apiKeyEnv: "JUNTO_TEST_KEY" } } }
    expect(() => resolveBackend("anthropic", config)).toThrow(/JUNTO_TEST_KEY/)
  })

  it("resolves a usable backend once the env var is set", () => {
    process.env.JUNTO_TEST_KEY = "sk-test"
    const config: Config = {
      ...baseConfig,
      backends: { anthropic: { apiKeyEnv: "JUNTO_TEST_KEY", model: "m", timeoutMs: 9000 } },
    }
    const resolved = resolveBackend("anthropic", config)
    expect(resolved.model).toBe("m")
    expect(resolved.timeoutMs).toBe(9000)
    expect(typeof resolved.backend.complete).toBe("function")
  })
})
