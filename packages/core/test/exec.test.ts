import { chmodSync, closeSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { resolveExecutable } from "../src/exec.js"

let dir: string
const tmpDirs: string[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "junto-exec-"))
  tmpDirs.push(dir)
})

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    rmSync(d, { recursive: true, force: true })
  }
})

describe("resolveExecutable", () => {
  it("finds a command on PATH by bare name", () => {
    // `node` itself is guaranteed to be on PATH in this test environment.
    expect(resolveExecutable("node", dir)).toBe(true)
  })

  it("returns false for a bare name not on PATH", () => {
    expect(resolveExecutable("junto-command-does-not-exist-abc123", dir)).toBe(false)
  })

  it("resolves a relative path against cwd", () => {
    const scriptPath = join(dir, "script.sh")
    closeSync(openSync(scriptPath, "w"))
    writeFileSync(scriptPath, "#!/bin/sh\necho hi\n")
    if (process.platform !== "win32") chmodSync(scriptPath, 0o755)
    expect(resolveExecutable("./script.sh", dir)).toBe(true)
  })

  it("returns false for a relative path that does not exist", () => {
    expect(resolveExecutable("./nope.sh", dir)).toBe(false)
  })

  it("returns false for a directory (not a file)", () => {
    const subdir = join(dir, "adir")
    mkdirSync(subdir)
    expect(resolveExecutable(subdir, dir)).toBe(false)
  })
})
