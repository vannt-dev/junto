import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { baseDrift, captureVerifyBase } from "../src/base-drift.js"

let dir: string
const git = (cwd: string, ...args: string[]): string => execFileSync("git", args, {
  cwd, stdio: ["ignore", "pipe", "pipe"],
}).toString().trim()

function commit(cwd: string, file: string): void {
  writeFileSync(join(cwd, file), file)
  git(cwd, "add", file)
  git(cwd, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", file)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "junto-base-"))
  git(dir, "init", "-q", "--bare", "-b", "main", "origin.git")
  git(dir, "clone", "-q", "origin.git", "other")
  commit(join(dir, "other"), "a.txt")
  git(join(dir, "other"), "push", "-q", "origin", "HEAD:main")
  git(dir, "clone", "-q", "origin.git", "lane")
  git(join(dir, "lane"), "switch", "-qc", "feature")
  commit(join(dir, "lane"), "b.txt")
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe("base drift", () => {
  it("records the origin default branch tip", async () => {
    const lane = join(dir, "lane")
    const base = await captureVerifyBase(lane)
    expect(base).toEqual({ ref: "refs/remotes/origin/main", commit: git(lane, "rev-parse", "origin/main") })
    expect(await baseDrift(lane, base)).toBeNull()
  })

  it("reports commits on the base that the branch does not contain, as of the last fetch", async () => {
    const lane = join(dir, "lane")
    const base = await captureVerifyBase(lane)
    commit(join(dir, "other"), "c.txt")
    git(join(dir, "other"), "push", "-q", "origin", "HEAD:main")
    expect(await baseDrift(lane, base)).toBeNull()

    git(lane, "fetch", "-q")
    expect(await baseDrift(lane, base)).toEqual({ ref: "origin/main", newCommits: 1 })

    git(lane, "-c", "user.name=t", "-c", "user.email=t@example.com", "merge", "-q", "--no-edit", "origin/main")
    expect(await baseDrift(lane, base)).toBeNull()
  })

  it("falls back to origin/main when origin/HEAD is not set", async () => {
    const lane = join(dir, "lane")
    git(lane, "remote", "set-head", "origin", "--delete")
    expect((await captureVerifyBase(lane))?.ref).toBe("refs/remotes/origin/main")
  })

  it("records nothing and checks nothing without a remote base", async () => {
    const lane = join(dir, "lane")
    git(lane, "remote", "remove", "origin")
    expect(await captureVerifyBase(lane)).toBeNull()
    expect(await baseDrift(lane, undefined)).toBeNull()
    expect(await baseDrift(lane, { ref: "refs/remotes/origin/main", commit: "0".repeat(40) })).toBeNull()
  })

  it("records nothing outside a Git repository", async () => {
    expect(await captureVerifyBase(dir)).toBeNull()
  })
})
