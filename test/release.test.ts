import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { parseConfig } from "@junto/core"
import { RUNNER } from "../packages/mcp/src/context.js"
import { VERSION } from "../packages/mcp/src/version.js"

const json = (path: string): unknown => JSON.parse(readFileSync(path, "utf-8"))

describe("release assets", () => {
  it.each([
    "examples/config.basic.json",
    "examples/config.multi-model.json",
  ])("ships a valid config example: %s", (path) => {
    expect(() => parseConfig(json(path))).not.toThrow()
  })

  it("keeps plugin, marketplace, and package versions aligned", () => {
    const plugin = json(".claude-plugin/plugin.json") as { version: string }
    const marketplace = json(".claude-plugin/marketplace.json") as {
      metadata: { version: string }
      plugins: Array<{ version: string }>
    }
    const core = json("packages/core/package.json") as { version: string }
    const mcp = json("packages/mcp/package.json") as { version: string }

    expect(new Set([
      plugin.version,
      marketplace.metadata.version,
      marketplace.plugins[0]?.version,
      core.version,
      mcp.version,
      VERSION,
    ])).toEqual(new Set([plugin.version]))
    expect(RUNNER).toBe(`@junto/mcp@${plugin.version}`)
  })

  it("places MCP configuration at the plugin root", () => {
    const plugin = json(".claude-plugin/plugin.json") as { mcpServers?: unknown }
    const mcp = json(".mcp.json") as { mcpServers?: Record<string, unknown> }
    expect(plugin.mcpServers).toBeUndefined()
    expect(mcp.mcpServers?.junto).toBeDefined()
  })

  it("configures Codex CLI to read the Junto prompt from stdin", () => {
    const config = parseConfig(json("examples/config.multi-model.json"))
    expect(config.cliBackends?.codex?.argv.at(-1)).toBe("-")
  })
})
