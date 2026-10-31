import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const COMMANDS = join(import.meta.dirname, "..", "plugin", "commands")
const SERVER = readFileSync(join(import.meta.dirname, "..", "packages", "mcp", "src", "server.ts"), "utf8")
const SERVER_TOOLS = new Set([...SERVER.matchAll(/name: "(junto__\w+)"/g)].map((m) => m[1]))

// Claude Code names the tools of a plugin's MCP server mcp__plugin_<plugin>_<server>__<tool>;
// a server added by hand as "junto" gives mcp__junto__<tool>.
const PLUGIN_PREFIX = "mcp__plugin_junto_junto__"
const MANUAL_PREFIX = "mcp__junto__"

function allowedTools(file: string): string[] {
  const text = readFileSync(join(COMMANDS, file), "utf8")
  const line = text.split(/\r?\n/).find((l) => l.startsWith("allowed-tools:"))
  return line ? line.slice("allowed-tools:".length).split(",").map((t) => t.trim()).filter(Boolean) : []
}

const files = readdirSync(COMMANDS).filter((f) => f.endsWith(".md"))

describe("command allowed-tools", () => {
  it("finds the server's tools", () => {
    expect(SERVER_TOOLS.size).toBeGreaterThanOrEqual(8)
  })

  for (const file of files) {
    it(`${file} allows each junto tool under the plugin name and the manual name`, () => {
      const tools = allowedTools(file)
      const junto = tools.filter((t) => t.startsWith(PLUGIN_PREFIX) || t.startsWith(MANUAL_PREFIX))
      const names = new Set(junto.map((t) => t.replace(PLUGIN_PREFIX, "").replace(MANUAL_PREFIX, "")))
      for (const name of names) {
        expect(SERVER_TOOLS, `${file}: ${name} is not a junto tool`).toContain(name)
        expect(tools, `${file}: plugin name for ${name}`).toContain(PLUGIN_PREFIX + name)
        expect(tools, `${file}: manual name for ${name}`).toContain(MANUAL_PREFIX + name)
      }
    })
  }
})

describe("start command gate detection", () => {
  it("looks at Python projects too", () => {
    const start = readFileSync(join(COMMANDS, "start.md"), "utf8")
    for (const marker of ["pyproject.toml", "requirements", "pytest", ".venv"]) {
      expect(start).toContain(marker)
    }
  })
})
