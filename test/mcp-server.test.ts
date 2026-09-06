import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

const temporaryRoots: string[] = []

afterEach(() => {
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop()
    if (root !== undefined) rmSync(root, { recursive: true, force: true })
  }
})

describe("MCP bundle stdio", () => {
  it("starts and exposes all five M1+M2 tools", async () => {
    const root = mkdtempSync(join(tmpdir(), "junto-mcp-"))
    temporaryRoots.push(root)
    mkdirSync(join(root, ".junto"), { recursive: true })
    writeFileSync(join(root, ".junto", "config.json"), JSON.stringify({ schemaVersion: 1, gates: {} }))

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve("plugin/mcp/server.js")],
      cwd: root,
      stderr: "pipe",
    })
    const client = new Client({ name: "junto-test", version: "0.0.0" }, { capabilities: {} })
    try {
      await client.connect(transport)
      const response = await client.listTools()
      expect(response.tools.map(tool => tool.name).sort()).toEqual([
        "junto__advance",
        "junto__consult",
        "junto__panel",
        "junto__task",
        "junto__verify",
      ])
      const advance = response.tools.find(tool => tool.name === "junto__advance")
      expect(advance?.inputSchema.properties?.to).toMatchObject({
        enum: ["brief", "plan", "panel", "build", "review", "verify", "done"],
      })
    } finally {
      await client.close()
    }
  })
})
