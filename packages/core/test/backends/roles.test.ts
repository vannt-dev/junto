import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { BUILT_IN_ROLES, DEFAULT_ROLE_PROMPT, isBuiltInRole, resolveRolePrompt } from "../../src/backends/roles.js"

const tmpDirs: string[] = []
afterEach(() => { for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "junto-roles-"))
  tmpDirs.push(root)
  return root
}

describe("isBuiltInRole", () => {
  it("recognizes all four built-in roles", () => {
    for (const role of BUILT_IN_ROLES) expect(isBuiltInRole(role)).toBe(true)
  })

  it("rejects a made-up role name", () => {
    expect(isBuiltInRole("philosopher")).toBe(false)
  })
})

describe("resolveRolePrompt", () => {
  it("returns the built-in prompt for a known role with no override on disk", () => {
    const root = makeRoot()
    expect(resolveRolePrompt(root, "architect")).toBe(DEFAULT_ROLE_PROMPT.architect)
  })

  it("prefers a project override file over the built-in prompt", () => {
    const root = makeRoot()
    mkdirSync(join(root, ".junto", "roles"), { recursive: true })
    writeFileSync(join(root, ".junto", "roles", "architect.md"), "custom architect prompt\n", "utf-8")
    expect(resolveRolePrompt(root, "architect")).toBe("custom architect prompt\n")
  })

  it("uses an override file for a custom, non-built-in role name", () => {
    const root = makeRoot()
    mkdirSync(join(root, ".junto", "roles"), { recursive: true })
    writeFileSync(join(root, ".junto", "roles", "philosopher.md"), "custom philosopher prompt\n", "utf-8")
    expect(resolveRolePrompt(root, "philosopher")).toBe("custom philosopher prompt\n")
  })

  it("throws a clear error for an unknown role with no override file", () => {
    const root = makeRoot()
    expect(() => resolveRolePrompt(root, "philosopher")).toThrow(/unknown role "philosopher"/i)
  })
})
