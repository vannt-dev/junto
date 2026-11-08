import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { readActiveId, readTask } from "@junto/core"
import { advanceTool } from "../src/tools/advance.js"
import { statusTool } from "../src/tools/status.js"
import { taskTool } from "../src/tools/task.js"
import { verifyTool } from "../src/tools/verify.js"

let dir: string
let main: string
const ctx = (root: string) => ({ root, runner: "test@0" })
const git = (cwd: string, ...args: string[]): string => execFileSync("git", [
  "-c", "user.name=t", "-c", "user.email=t@example.com", ...args,
], { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString().trim()

function commit(cwd: string, file: string): void {
  writeFileSync(join(cwd, file), file)
  git(cwd, "add", file)
  git(cwd, "commit", "-qm", file)
}

/** Push a commit to origin/main from a separate clone, as another lane's merge would. */
function mergeElsewhere(file: string): void {
  const other = join(dir, "other")
  if (!existsSync(other)) git(dir, "clone", "-q", "origin.git", "other")
  else git(other, "pull", "-q")
  commit(other, file)
  git(other, "push", "-q", "origin", "HEAD:main")
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "junto-status-all-"))
  git(dir, "init", "-q", "--bare", "-b", "main", "origin.git")
  git(dir, "clone", "-q", "origin.git", "main")
  main = join(dir, "main")
  git(main, "symbolic-ref", "HEAD", "refs/heads/main")
  mkdirSync(join(main, ".junto"))
  writeFileSync(join(main, ".junto", "config.json"), JSON.stringify({
    schemaVersion: 1,
    gates: { tests: { argv: ["node", "-e", "process.exit(0)"], required: true } },
  }))
  git(main, "add", ".junto/config.json")
  commit(main, "a.txt")
  git(main, "push", "-q", "origin", "main")
  git(main, "remote", "set-head", "origin", "main")
  for (const n of [1, 2, 3]) git(main, "worktree", "add", "-q", "-b", `lane-${n}`, join(dir, `wt-${n}`))
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe("status across worktrees", () => {
  it("lists each worktree's active task, a worktree without one, and an unreadable one", async () => {
    await taskTool(ctx(main), { action: "start", title: "Main task", size: "small" })
    await taskTool(ctx(join(dir, "wt-1")), { action: "start", title: "Lane task", size: "standard" })
    writeFileSync(join(dir, "wt-3", ".junto", "active"), "missing-task\n")

    const output = await statusTool(ctx(main), { all: true })

    const sections = output.split(/^## /m).slice(1)
    expect(sections).toHaveLength(4)
    expect(sections[0]).toMatch(/^main \(this worktree\)/)
    expect(sections[0]).toMatch(/Task: .* — Main task/)
    expect(sections[0]).toMatch(/Phase: build/)
    expect(sections[0]).toMatch(/Gates: tests not run/)
    expect(sections[1]).toMatch(/^lane-1\n/)
    expect(sections[1]).toMatch(/wt-1/)
    expect(sections[1]).toMatch(/Lane task/)
    expect(sections[1]).toMatch(/Blockers: brief\.md is missing or empty/)
    expect(sections[2]).toMatch(/No active task/)
    expect(sections[3]).toMatch(/Error: cannot read/)
  })

  it("marks the calling worktree as the current one", async () => {
    const output = await statusTool(ctx(join(dir, "wt-2")), { all: true })
    expect(output).toMatch(/## lane-2 \(this worktree\)/)
    expect(output).not.toMatch(/## main \(this worktree\)/)
  })

  it("writes a self-contained, escaped board only inside this project's .junto", async () => {
    await taskTool(ctx(main), { action: "start", title: "<b>x</b> & \"y\"", size: "small" })
    await taskTool(ctx(join(dir, "wt-1")), { action: "start", title: "Lane task", size: "small" })
    rmSync(join(main, ".junto", ".gitignore"))
    writeFileSync(join(main, ".junto", ".gitignore"), "*.log")

    const output = await statusTool(ctx(main), { html: true })

    const board = join(main, ".junto", "board.html")
    expect(output).toContain(board)
    const html = readFileSync(board, "utf-8")
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;")
    expect(html).not.toContain("<b>x</b>")
    expect(html).toContain("Lane task")
    expect(html).toContain("prefers-color-scheme:dark")
    expect(html).not.toMatch(/<script|https?:\/\/|<link|src=/i)
    expect(readFileSync(join(main, ".junto", ".gitignore"), "utf-8")).toBe("*.log\nboard.html\n")
    expect(existsSync(join(dir, "wt-1", ".junto", "board.html"))).toBe(false)

    await statusTool(ctx(main), { html: true })
    expect(readFileSync(join(main, ".junto", ".gitignore"), "utf-8")).toBe("*.log\nboard.html\n")
  })

  it("ignores the board in a new project's .junto/.gitignore", async () => {
    await taskTool(ctx(join(dir, "wt-2")), { action: "start", title: "X", size: "small" })
    expect(readFileSync(join(dir, "wt-2", ".junto", ".gitignore"), "utf-8")).toBe("*.log\nboard.html\n")
  })
})

describe("base moved since verify", () => {
  async function verifiedLane(): Promise<string> {
    const lane = join(dir, "wt-1")
    await taskTool(ctx(lane), { action: "start", title: "Lane task", size: "small" })
    await advanceTool(ctx(lane), { to: "verify" })
    await verifyTool(ctx(lane), {})
    return lane
  }

  it("records the base tip with the verdict", async () => {
    const lane = await verifiedLane()
    const id = readActiveId(lane)
    if (id === null) throw new Error("Test requires an active task")
    expect(readTask(lane, id).gates.tests?.base).toEqual({
      ref: "refs/remotes/origin/main", commit: git(lane, "rev-parse", "origin/main"),
    })
    expect(await statusTool(ctx(lane))).not.toMatch(/Warning/)
  })

  it("warns in status and at done, without blocking, until the branch contains the new base", async () => {
    const lane = await verifiedLane()
    mergeElsewhere("c.txt")
    git(lane, "fetch", "-q")

    const status = await statusTool(ctx(lane))
    expect(status).toMatch(/Warning: origin\/main moved since verify \(1 new commit as of the last fetch\)/)
    expect(status).toMatch(/run \/junto:verify again/)
    expect(status).toMatch(/Blockers: none/)
    expect(await statusTool(ctx(main), { all: true })).toMatch(/## lane-1[\s\S]*Warning: origin\/main moved/)

    expect(await advanceTool(ctx(lane), { to: "done" })).toMatch(/transitioned to phase done\. Warning: origin\/main moved/)

    git(lane, "merge", "-q", "--no-edit", "origin/main")
    expect(await statusTool(ctx(lane))).not.toMatch(/Warning/)
  })

  it("records nothing and warns about nothing without a remote base", async () => {
    git(main, "remote", "remove", "origin")
    const lane = await verifiedLane()
    const id = readActiveId(lane)
    if (id === null) throw new Error("Test requires an active task")
    expect(readTask(lane, id).gates.tests?.base).toBeUndefined()
    expect(await statusTool(ctx(lane))).not.toMatch(/Warning/)
  })
})
