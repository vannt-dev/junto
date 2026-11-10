// Records the replay on the landing page: one small real task taken through junto, from start to
// archive. Writes site/replay/junto.jsonl, one {"cmd", "step", "ms", "out", "state"} per line.
//
//   corepack pnpm install && corepack pnpm build
//   ROOT=F:/demo node site/replay/record.mjs
//   node site/replay/render.mjs
//
// ROOT is a short throwaway folder; the project is created at ROOT/slug and removed first if it is
// there. Nothing here imitates junto: tool calls go to the built MCP server (plugin/mcp/server.js)
// over stdio, and the approval and the refused write go through the built hooks (plugin/hooks) with
// the payload Claude Code sends them. The files an agent would write (brief, plan, code) are written
// by this script and shown as notes. "state" is read from .junto/ on disk after each step.
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, "..", "..")
const ROOT = process.env.ROOT
if (!ROOT) throw new Error("set ROOT to a short throwaway folder, for example ROOT=F:/demo")
const project = resolve(ROOT, "slug")
const out = join(here, "junto.jsonl")

// The project: one function, one test, two gates.
rmSync(project, { recursive: true, force: true })
const put = (rel, text) => {
  mkdirSync(dirname(join(project, rel)), { recursive: true })
  writeFileSync(join(project, rel), text)
}
put("package.json", `${JSON.stringify({ name: "slug", private: true, type: "module" }, null, 2)}\n`)
put("src/slugify.js", `export function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-")
}
`)
put("test/slugify.test.js", `import assert from "node:assert/strict"
import { test } from "node:test"
import { slugify } from "../src/slugify.js"

test("joins words with a dash", () => {
  assert.equal(slugify("Hello World"), "hello-world")
})
`)
put(".junto/config.json", `${JSON.stringify({
  schemaVersion: 1,
  gates: {
    syntax: { argv: ["node", "--check", "src/slugify.js"], required: true, timeoutMs: 60000 },
    tests: { argv: ["node", "--test"], required: true, timeoutMs: 60000 },
  },
}, null, 2)}\n`)
const git = (...args) => execFileSync("git", args, { cwd: project, stdio: "pipe" })
git("init", "-q", "-b", "main")
git("config", "user.name", "demo")
git("config", "user.email", "demo@example.invalid")
git("config", "core.autocrlf", "false")
git("add", ".")
git("commit", "-q", "-m", "feat: slugify")

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(repo, "plugin", "mcp", "server.js")],
  cwd: project,
  stderr: "pipe",
})
const client = new Client({ name: "junto-replay", version: "0.0.0" }, { capabilities: {} })
await client.connect(transport)

let id = null
const taskHome = () => [join(project, ".junto", "tasks", id), join(project, ".junto", "archive", id)].find(existsSync)

/** What .junto/ says after a step: the numbers beside the log come from here, not from the text. */
function state() {
  if (id === null) return {}
  const dir = taskHome()
  const task = JSON.parse(readFileSync(join(dir, "task.json"), "utf-8"))
  const verdicts = existsSync(join(dir, "verdicts")) ? readdirSync(join(dir, "verdicts")) : []
  const gates = Object.entries(task.gates)
  const passed = gates.filter(([, gate]) => {
    if (gate.verdict === null || gate.stale) return false
    return JSON.parse(readFileSync(join(dir, gate.verdict), "utf-8")).state === "pass"
  })
  return {
    phase: dir.includes("archive") ? "archived" : task.phase,
    plan: task.phases.plan?.approvedBy === "user" ? "approved" : existsSync(join(dir, "plan.md")) ? "not approved" : "none",
    gates: `${passed.length}/${gates.length}`,
    evidence: verdicts.length,
  }
}

const lines = []
// Absolute paths of this machine never reach the page.
const clean = text => text.replaceAll(project, ".").replaceAll(project.replaceAll("\\", "/"), ".").replace(/\r\n/g, "\n").trimEnd()
function record(step, cmd, ms, text) {
  lines.push(JSON.stringify({ cmd, step, ms, out: clean(text), state: state() }))
}
const note = (step, text) => record(step, `# ${text}`, 0, "")

/** A real call to the MCP server; a refusal comes back as the tool's error text. */
async function tool(step, name, args) {
  const started = performance.now()
  const result = await client.callTool({ name, arguments: args ?? {} })
  const ms = Math.round(performance.now() - started)
  const text = result.content.map(part => part.text).join("\n")
  const created = /^Created task "([^"]+)"/.exec(text)
  if (created) id = created[1]
  record(step, `> ${name}${args ? ` ${JSON.stringify(args)}` : ""}`, ms, text)
  return text
}

/** A built hook, run as Claude Code runs it: the event as JSON on stdin, the answer on stdout. */
function hook(file, payload) {
  const started = performance.now()
  const res = spawnSync(process.execPath, [join(repo, "plugin", "hooks", file)], {
    cwd: project, input: JSON.stringify({ cwd: project, ...payload }), encoding: "utf-8",
  })
  return { ms: Math.round(performance.now() - started), answer: JSON.parse(res.stdout).hookSpecificOutput }
}

// 0. Start
await tool(0, "junto__task", { action: "start", title: "Trim dashes in slugify", size: "standard" })
const rel = `.junto/tasks/${id}`

// 1. Brief and plan
put(`${rel}/brief.md`, `# Trim dashes in slugify

slugify(" Hello, World! ") returns "-hello-world-". Leading and trailing dashes must go.
Out of scope: accents, length limits.
`)
note(1, `the agent writes ${rel}/brief.md`)
await tool(1, "junto__advance", { to: "plan" })
await tool(1, "junto__plan")
put(`${rel}/plan.md`, `# Plan

1. test/slugify.test.js: add a test for " Hello, World! " -> "hello-world". Verify: the tests gate fails.
2. src/slugify.js: trim dashes at both ends. Verify: the syntax and tests gates pass.
`)
put(`${rel}/context.jsonl`, `${JSON.stringify({ file: "src/slugify.js", reason: "the function to change" })}\n`)
note(1, `the agent writes ${rel}/plan.md`)

// 2. The agent cannot approve its own plan
note(2, "the agent tries to start building without your approval")
await tool(2, "junto__advance", { to: "build" })
note(2, "the agent tries to write the approval into task.json itself")
const denied = hook("guard.js", {
  hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: join(project, rel, "task.json") },
})
if (denied.answer.permissionDecision !== "deny") throw new Error("the guard hook did not refuse the write")
record(2, `> Write ${rel}/task.json`, denied.ms, `PreToolUse hook: ${denied.answer.permissionDecision}\n${denied.answer.permissionDecisionReason}`)

// 3. The person approves: the hook on the prompt records it; the model has no tool that does
const approved = hook("state.js", { hook_event_name: "UserPromptSubmit", prompt: "/junto:approve" })
record(3, "gate: /junto:approve", approved.ms, `UserPromptSubmit hook:\n${approved.answer.additionalContext}`)
await tool(3, "junto__advance", { to: "build" })

// 4. Build with a fix that is not enough; the gate says so
put("test/slugify.test.js", `import assert from "node:assert/strict"
import { test } from "node:test"
import { slugify } from "../src/slugify.js"

test("joins words with a dash", () => {
  assert.equal(slugify("Hello World"), "hello-world")
})

test("trims dashes at both ends", () => {
  assert.equal(slugify(" Hello, World! "), "hello-world")
})
`)
put("src/slugify.js", `export function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-/, "")
}
`)
note(4, "the agent adds a test and edits src/slugify.js")
await tool(4, "junto__advance", { to: "verify" })
await tool(4, "junto__verify")
note(4, "the agent tries to call the task done")
await tool(4, "junto__advance", { to: "done" })

// 5. The real fix
put("src/slugify.js", `export function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
}
`)
note(5, "the agent fixes src/slugify.js: the trailing dash too")
await tool(5, "junto__verify")
await tool(5, "junto__advance", { to: "done" })

// 6. Finish
await tool(6, "junto__task", { action: "finish" })
const summary = `.junto/archive/${id}/summary.md`
record(6, `$ cat ${summary}`, 0, readFileSync(join(project, summary), "utf-8"))

await client.close()
const all = lines.join("\n")
if (/Users[\\/]/.test(all)) throw new Error("a home folder path is in the recorded output; use a short ROOT")
writeFileSync(out, `${all}\n`)
console.log(`recorded ${lines.length} steps to ${out}`)
