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

describe("resolveBackend — cliBackends", () => {
  it("resolves a role whose provider names a cliBackends entry", () => {
    const config: Config = {
      ...baseConfig,
      cliBackends: { codex: { argv: ["node", "-e", "process.exit(0)"] } },
    }
    const resolved = resolveBackend("codex", config)
    expect(typeof resolved.backend.complete).toBe("function")
  })

  it("checks backends before cliBackends", () => {
    process.env.JUNTO_TEST_KEY = "sk-test"
    const config: Config = {
      ...baseConfig,
      backends: { dual: { apiKeyEnv: "JUNTO_TEST_KEY" } },
      cliBackends: { dual: { argv: ["node", "-e", "process.exit(0)"] } },
    }
    expect(() => resolveBackend("dual", config)).toThrow(/not a supported api vendor/i)
  })

  it("throws naming both config sections when a name is in neither", () => {
    expect(() => resolveBackend("nonexistent", baseConfig))
      .toThrow(/backends.*cliBackends|cliBackends.*backends/is)
  })

  it("throws clearly for a backends entry keyed by an unsupported vendor name, without falling through to openai", () => {
    process.env.JUNTO_TEST_KEY = "sk-test"
    const config: Config = { ...baseConfig, backends: { cohere: { apiKeyEnv: "JUNTO_TEST_KEY" } } }
    expect(() => resolveBackend("cohere", config)).toThrow(/not a supported api vendor/i)
  })
})
