import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join, relative } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { readActiveId } from "@junto/core"
import { advanceTool } from "../packages/mcp/src/tools/advance.js"
import { consultTool } from "../packages/mcp/src/tools/consult.js"
import { taskTool } from "../packages/mcp/src/tools/task.js"
import { verifyTool } from "../packages/mcp/src/tools/verify.js"

const temporaryRoots: string[] = []

function snapshot(dir: string): Map<string, number> {
  const output = new Map<string, number>()
  if (!existsSync(dir)) return output
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) {
        output.set(path, 0)
        walk(path)
      } else {
        output.set(path, statSync(path).mtimeMs)
      }
    }
  }
  walk(dir)
  return output
}

function makeRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  temporaryRoots.push(root)
  return root
}

afterEach(() => {
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop()
    if (root !== undefined) rmSync(root, { recursive: true, force: true })
  }
})

describe("R1 - Junto writes only inside .junto/", () => {
  it("keeps a complete task lifecycle inside .junto/", async () => {
    const root = makeRoot("junto-boundary-")
    mkdirSync(join(root, ".junto"), { recursive: true })
    mkdirSync(join(root, "src"), { recursive: true })
    writeFileSync(join(root, "src", "app.ts"), "export const a = 1\n", "utf-8")
    writeFileSync(join(root, "README.md"), "# test\n", "utf-8")
    writeFileSync(join(root, ".gitignore"), "node_modules/\n", "utf-8")
    writeFileSync(join(root, ".junto", "config.json"), JSON.stringify({
      schemaVersion: 1,
      gates: { tests: { argv: ["node", "-e", "process.exit(0)"], required: true } },
    }), "utf-8")

    const before = snapshot(root)
    const ctx = { root, runner: "boundary@0" }
    await taskTool(ctx, { action: "start", title: "Test boundary", size: "small" })
    await advanceTool(ctx, { to: "verify" })
    await verifyTool(ctx, {})
    await advanceTool(ctx, { to: "done" })
    await taskTool(ctx, { action: "finish" })

    const after = snapshot(root)
    const junto = join(root, ".junto")
    const touched: string[] = []
    for (const [path, mtime] of after) {
      if (path === junto || path.startsWith(`${junto}\\`) || path.startsWith(`${junto}/`)) continue
      const previous = before.get(path)
      if (previous === undefined || previous !== mtime) touched.push(relative(root, path))
    }
    for (const path of before.keys()) {
      if (path === junto || path.startsWith(`${junto}\\`) || path.startsWith(`${junto}/`)) continue
      if (!after.has(path)) touched.push(`DELETED: ${relative(root, path)}`)
    }
    expect(touched, `Junto changed a file outside .junto/: ${touched.join(", ")}`).toEqual([])
  })

  it("keeps a consult call inside .junto/", async () => {
    const root = makeRoot("junto-boundary-consult-")
    mkdirSync(join(root, ".junto"), { recursive: true })
    writeFileSync(join(root, ".junto", "config.json"), JSON.stringify({
      schemaVersion: 1,
      gates: {},
      backends: { anthropic: { apiKeyEnv: "JUNTO_BOUNDARY_TEST_KEY" } },
    }), "utf-8")
    process.env.JUNTO_BOUNDARY_TEST_KEY = "sk-test"
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: "looks fine" }],
        usage: { input_tokens: 1, output_tokens: 1 },
        model: "claude-sonnet-5",
      }),
    }))

    const before = snapshot(root)
    const ctx = { root, runner: "boundary@0" }
    await taskTool(ctx, { action: "start", title: "Test boundary consult", size: "standard" })
    await consultTool(ctx, { role: "architect", question: "Sound?" })

    const after = snapshot(root)
    const junto = join(root, ".junto")
    const touched: string[] = []
    for (const [path, mtime] of after) {
      if (path === junto || path.startsWith(`${junto}\\`) || path.startsWith(`${junto}/`)) continue
      const previous = before.get(path)
      if (previous === undefined || previous !== mtime) touched.push(relative(root, path))
    }
    expect(touched, `Junto changed a file outside .junto/: ${touched.join(", ")}`).toEqual([])

    vi.unstubAllGlobals()
    delete process.env.JUNTO_BOUNDARY_TEST_KEY
  })

  it("does not create state in HOME or modify Claude settings", async () => {
    const root = makeRoot("junto-home-")
    mkdirSync(join(root, ".junto"), { recursive: true })
    writeFileSync(join(root, ".junto", "config.json"), JSON.stringify({ schemaVersion: 1, gates: {} }), "utf-8")

    const homeJunto = join(homedir(), ".junto")
    const settings = join(homedir(), ".claude", "settings.json")
    const homeJuntoBefore = existsSync(homeJunto)
    const settingsBefore = existsSync(settings) ? statSync(settings).mtimeMs : null
    await taskTool({ root, runner: "boundary@0" }, { action: "start", title: "X", size: "small" })

    expect(readActiveId(root)).not.toBeNull()
    expect(existsSync(homeJunto)).toBe(homeJuntoBefore)
    expect(existsSync(settings) ? statSync(settings).mtimeMs : null).toBe(settingsBefore)
  })
})
