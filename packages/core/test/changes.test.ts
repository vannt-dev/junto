import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ChangedFileResolver, ChangedFilesError } from "../src/changes.js"

describe("ChangedFileResolver parsing", () => {
  const resolver = new ChangedFileResolver()

  it("parses standard git diff name-status output", () => {
    const rawOutput = `
M\tsrc/auth/service.ts
A\tsrc/auth/token.ts
D\tsrc/legacy.ts
R100\told/path.ts\tnew/path.ts
`
    expect(resolver.parseNameStatusOutput(rawOutput)).toEqual([
      { path: "src/auth/service.ts", status: "modified" },
      { path: "src/auth/token.ts", status: "added" },
      { path: "src/legacy.ts", status: "deleted" },
      { path: "new/path.ts", status: "renamed" },
    ])
  })

  it("keeps paths that contain spaces", () => {
    expect(resolver.parseNameStatusOutput("M\tsrc/my file.ts\n")).toEqual([{ path: "src/my file.ts", status: "modified" }])
    expect(resolver.parseNameStatusZ("M\0src/my file.ts\0R087\0old name.ts\0new name.ts\0"))
      .toEqual([
        { path: "src/my file.ts", status: "modified" },
        { path: "new name.ts", status: "renamed" },
      ])
  })

  it("filters out ignored files", () => {
    const rawOutput = "M\tsrc/index.ts\nM\tnode_modules/pkg/index.js\nA\t.junto/tasks/1.json\nA\tdist/bundle.js\n"
    expect(resolver.parseNameStatusOutput(rawOutput)).toEqual([{ path: "src/index.ts", status: "modified" }])
  })

  it("supports custom ignore patterns", () => {
    expect(resolver.parseNameStatusOutput("M\tsrc/index.ts\nM\tdocs/readme.md\n", ["docs/**"]))
      .toEqual([{ path: "src/index.ts", status: "modified" }])
  })

  it("deduplicates identical paths", () => {
    expect(resolver.parseNameStatusOutput("M\tsrc/index.ts\nM\tsrc/index.ts\n")).toHaveLength(1)
  })
})

describe("ChangedFileResolver against a real repository", () => {
  let repo: string
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" })
  const write = (rel: string, body = "x\n") => {
    mkdirSync(dirname(join(repo, rel)), { recursive: true })
    writeFileSync(join(repo, rel), body)
  }

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "junto-changes-"))
    git("init", "-q")
    git("config", "user.email", "t@example.com")
    git("config", "user.name", "t")
    git("config", "commit.gpgsign", "false")
    write("src/keep.ts")
    write("src/gone.ts")
    write("src/old name.ts", "same content that is long enough for rename detection\n".repeat(5))
    git("add", ".")
    git("commit", "-q", "-m", "init")
  })

  afterEach(() => { rmSync(repo, { recursive: true, force: true }) })

  it("reports modified, deleted, renamed, staged and untracked files, and skips ignored ones", async () => {
    write("src/keep.ts", "changed\n")
    rmSync(join(repo, "src/gone.ts"))
    renameSync(join(repo, "src/old name.ts"), join(repo, "src/new name.ts"))
    git("add", "-A")
    write("src/fresh file.ts")
    write("dist/out.js")

    const files = await new ChangedFileResolver().resolve(repo)
    const byPath = Object.fromEntries(files.map(f => [f.path, f.status]))
    expect(byPath).toEqual({
      "src/keep.ts": "modified",
      "src/gone.ts": "deleted",
      "src/new name.ts": "renamed",
      "src/fresh file.ts": "added",
    })
  })

  it("compares against a base commit including later commits", async () => {
    const base = git("rev-parse", "HEAD").toString().trim()
    write("src/later.ts")
    git("add", ".")
    git("commit", "-q", "-m", "later")
    const files = await new ChangedFileResolver().resolve(repo, { base })
    expect(files).toEqual([{ path: "src/later.ts", status: "added" }])
  })

  it("throws instead of returning an empty list when git fails", async () => {
    await expect(new ChangedFileResolver().resolve(repo, { base: "no-such-ref" })).rejects.toBeInstanceOf(ChangedFilesError)
    const notARepo = mkdtempSync(join(tmpdir(), "junto-nogit-"))
    try {
      await expect(new ChangedFileResolver().resolve(notARepo)).rejects.toBeInstanceOf(ChangedFilesError)
    } finally {
      rmSync(notARepo, { recursive: true, force: true })
    }
  })
})
