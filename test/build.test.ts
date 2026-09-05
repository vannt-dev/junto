import { existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const artifacts = [
  "plugin/hooks/state.js",
  "plugin/hooks/guard.js",
  "plugin/hooks/session.js",
  "plugin/hooks/handoff.js",
  "plugin/mcp/server.js",
]

describe("artifact build", () => {
  it("creates all five bundle files", () => {
    for (const artifact of artifacts) expect(existsSync(artifact), `missing ${artifact}`).toBe(true)
  })

  it("leaves no external package imports in bundles", () => {
    for (const artifact of artifacts) {
      const source = readFileSync(artifact, "utf-8")
      const bad = source.match(/^\s*import\s+[^"']*["'](?!node:)[^"']+["']/gm)
      expect(bad, `${artifact} still has external imports: ${bad?.join(", ")}`).toBeNull()
    }
  })

  it("creates nonempty bundles", () => {
    for (const artifact of artifacts) expect(statSync(artifact).size).toBeGreaterThan(500)
  })

  it("resolves every artifact path declared by the plugin configuration", () => {
    const hooks = JSON.parse(readFileSync("plugin/hooks.json", "utf-8"))
    const commands: Array<{ args?: string[] }> = Object.values(hooks.hooks)
      .flatMap(event => event as Array<{ hooks: Array<{ args?: string[] }> }>)
      .flatMap(event => event.hooks)
    const mcp = JSON.parse(readFileSync("plugin/.mcp.json", "utf-8"))
    const configured = [
      ...commands.flatMap(command => command.args ?? []),
      ...mcp.mcpServers.junto.args,
    ]
    for (const value of configured) {
      const rel = value.replace("${CLAUDE_PLUGIN_ROOT}/", "")
      expect(existsSync(join(process.cwd(), rel)), `configuration references a missing file: ${value}`).toBe(true)
    }
  })
})
