import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { execa } from "execa"
import {
  juntoDir, readActiveId, readConfig, readTask, requiredPhases, setActiveId, taskDir, updateTask, writeTask,
  SCHEMA_VERSION, canEnter, canRaiseSize,
  type GateStatus, type Size, type SizeChange, type Task,
} from "@junto/core"
import type { ToolContext } from "../context.js"
import { buildTransitionContext } from "./advance.js"

export type TaskToolInput =
  | { action: "start", title: string, size: Size, gates?: string[] }
  | { action: "finish" }
  | { action: "abandon", reason: string }
  | { action: "escalate", size: Size, reason: string }

const MAX_SLUG = 40

export function newTaskId(title: string, now: Date): string {
  const date = now.toISOString().slice(0, 10)
  const slug = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/g, "d").replace(/\u0110/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG)
    .replace(/-+$/, "")
  // Fall back to "task" when normalization leaves no ASCII slug characters.
  return `${date}-${slug === "" ? "task" : slug}`
}

/** "standard (escalated from small)" when the size was raised, else the plain size. */
export function sizeLabel(task: Task): string {
  const first = task.sizeChanges?.[0]
  return first === undefined ? task.size : `${task.size} (escalated from ${first.from})`
}

async function currentCommit(root: string): Promise<string | null> {
  try {
    const res = await execa("git", ["rev-parse", "HEAD"], { cwd: root, reject: false })
    return res.exitCode === 0 ? res.stdout.trim() : null
  } catch {
    return null
  }
}

async function start(ctx: ToolContext, input: Extract<TaskToolInput, { action: "start" }>): Promise<string> {
  if (readActiveId(ctx.root) !== null) {
    throw new Error(
      "A task is already active. junto supports one active task at a time; "
      + "run /junto:finish for the current task first, or the user can type /junto:abandon <reason> to drop it.",
    )
  }

  const config = readConfig(ctx.root)
  const now = new Date()
  const id = newTaskId(input.title, now)
  const iso = now.toISOString()

  const dir = taskDir(ctx.root, id)
  const archiveDir = join(juntoDir(ctx.root), "archive", id)
  // Fail closed before creating files: check both active and archived destinations.
  if (existsSync(dir)) {
    throw new Error(
      `Task "${id}" already exists in .junto/tasks/ (same date and title as an open task). `
      + "Choose a different title to avoid an ID collision.",
    )
  }
  if (existsSync(archiveDir)) {
    throw new Error(
      `Task "${id}" already exists in .junto/archive/ (same date and title as an archived task). `
      + "Choose a different title to avoid an ID collision.",
    )
  }

  const gates: Record<string, GateStatus> = {}
  const names = input.gates ?? Object.keys(config.gates)
  for (const name of names) {
    const spec = config.gates[name]
    if (!spec) continue
    gates[name] = { required: spec.required, verdict: null, stale: false, failStreak: 0 }
  }

  // Read the initial phase from the single policy source in requiredPhases().
  const order = requiredPhases(input.size)
  const firstPhase = order[0]
  if (firstPhase === undefined) {
    throw new Error(`requiredPhases("${input.size}") returned no initial phase.`)
  }

  const task: Task = {
    schemaVersion: SCHEMA_VERSION,
    id,
    title: input.title,
    size: input.size,
    phase: firstPhase,
    baseCommit: await currentCommit(ctx.root),
    createdAt: iso,
    updatedAt: iso,
    phases: { [firstPhase]: { status: "active", at: iso } },
    gates,
    decisions: [],
    consults: [],
    consultTokensUsed: 0,
  }

  mkdirSync(join(dir, "verdicts"), { recursive: true })
  if (!existsSync(join(dir, "brief.md"))) writeFileSync(join(dir, "brief.md"), "", "utf-8")
  writeFileSync(join(dir, "context.jsonl"), "", "utf-8")
  writeTask(ctx.root, task)
  setActiveId(ctx.root, id)

  // junto owns .junto/.gitignore and never touches the project's root .gitignore.
  const ignore = join(juntoDir(ctx.root), ".gitignore")
  if (!existsSync(ignore)) writeFileSync(ignore, "*.log\n", "utf-8")

  return `Created task "${id}" (size ${input.size}) in phase ${firstPhase}. `
    + `Gates: ${Object.keys(gates).join(", ") || "none"}.`
}

function finish(ctx: ToolContext): string {
  const id = readActiveId(ctx.root)
  if (id === null) throw new Error("There is no active task to finish.")

  const task = readTask(ctx.root, id)
  if (task.phase !== "done") {
    throw new Error(
      `Task "${id}" is not in the done phase (current: "${task.phase}"). `
      + "Run /junto:verify and pass every required gate before finishing.",
    )
  }
  const from = taskDir(ctx.root, id)
  const config = readConfig(ctx.root)
  const transition = buildTransitionContext(ctx.root, task, config)
  if (Object.keys(task.gates).some(name => config.gates[name]?.type === "review" || task.gates[name]?.stale)) {
    const check = canEnter({ ...task, phase: "verify" }, "done", transition)
    if (!check.ok) throw new Error(`Cannot archive task. ${check.reason}`)
  }
  const to = join(juntoDir(ctx.root), "archive", id)

  // Safety net for an archive directory created manually between start and finish.
  if (existsSync(to)) {
    throw new Error(
      `Task "${id}" already exists in .junto/archive/. junto will not overwrite it; `
      + "inspect the archive directory before trying again.",
    )
  }

  mkdirSync(join(juntoDir(ctx.root), "archive"), { recursive: true })

  const gateLines = Object.entries(task.gates)
    .map(([n, g]) => `- ${n}: ${g.verdict === null ? "not run" : g.stale ? "stale" : "run"}${g.required ? " (required)" : ""}`)
    .join("\n")
  const summary = `# ${task.title}\n\n`
    + `- id: ${task.id}\n- size: ${sizeLabel(task)}\n- final phase: ${task.phase}\n`
    + `- created: ${task.createdAt}\n- finished: ${new Date().toISOString()}\n\n`
    + `## Gates\n\n${gateLines || "(none)"}\n\n`
    + `## Decisions\n\n${task.decisions.map(d => `- ${d.what} - ${d.why}`).join("\n") || "(none)"}\n`

  writeFileSync(join(from, "summary.md"), summary, "utf-8")
  renameSync(from, to)
  setActiveId(ctx.root, null)

  return `Archived task "${id}" at .junto/archive/${id}/.`
}

/**
 * Archives the active task without its gates passing. Only the user can ask for this: the hook
 * records /junto:abandon in task.json, which the model cannot write.
 */
function abandon(ctx: ToolContext, reason: string): string {
  const id = readActiveId(ctx.root)
  if (id === null) throw new Error("There is no active task to abandon.")

  const task = readTask(ctx.root, id)
  if (task.abandonRequest?.by !== "user") {
    throw new Error(
      `Only the user can abandon task "${id}": they must type /junto:abandon <reason>. `
      + "Do not abandon a task to get past a gate; fix the cause or ask the user.",
    )
  }
  const why = reason.trim()
  if (why === "") throw new Error("Give the reason the user stated for abandoning the task.")

  const from = taskDir(ctx.root, id)
  const to = join(juntoDir(ctx.root), "archive", id)
  if (existsSync(to)) {
    throw new Error(
      `Task "${id}" already exists in .junto/archive/. junto will not overwrite it; `
      + "inspect the archive directory before trying again.",
    )
  }
  mkdirSync(join(juntoDir(ctx.root), "archive"), { recursive: true })

  const gateLines = Object.entries(task.gates)
    .map(([n, g]) => `- ${n}: ${g.verdict === null ? "not run" : g.stale ? "stale" : "run"}${g.required ? " (required)" : ""}`)
    .join("\n")
  const summary = `# Abandoned: ${task.title}\n\n`
    + "This task was abandoned at the user's request. It was not finished and its gates were not required to pass.\n\n"
    + `- id: ${task.id}\n- size: ${sizeLabel(task)}\n- stopped in phase: ${task.phase}\n`
    + `- created: ${task.createdAt}\n- abandon requested by the user: ${task.abandonRequest.at}\n`
    + `- abandoned: ${new Date().toISOString()}\n\n`
    + `## Reason\n\n${why}\n\n`
    + `## Gates\n\n${gateLines || "(none)"}\n\n`
    + `## Decisions\n\n${task.decisions.map(d => `- ${d.what} - ${d.why}`).join("\n") || "(none)"}\n`

  writeFileSync(join(from, "summary.md"), summary, "utf-8")
  renameSync(from, to)
  setActiveId(ctx.root, null)

  return `Abandoned task "${id}" in phase ${task.phase}; it is archived at .junto/archive/${id}/ and was not finished.`
}

/**
 * Raises the size of the active task. The model may call this without a user sentinel because a
 * larger size only adds obligations: the plan it may now owe still needs the user's /junto:approve.
 */
function escalate(ctx: ToolContext, input: Extract<TaskToolInput, { action: "escalate" }>): string {
  const id = readActiveId(ctx.root)
  if (id === null) throw new Error("There is no active task to escalate. Run /junto:start with the larger size.")

  const task = readTask(ctx.root, id)
  const why = input.reason.trim()
  if (why === "") throw new Error("Give the reason the task needs a larger size.")
  if (task.phase === "done") {
    throw new Error(`Task "${id}" is done; there are no steps left to make stricter. Run /junto:finish.`)
  }
  const check = canRaiseSize(task.size, input.size)
  if (!check.ok) throw new Error(check.reason)

  // Read config before writing so a broken config.json fails before the size changes.
  const config = readConfig(ctx.root)
  const at = new Date().toISOString()
  const change: SizeChange = { from: task.size, to: input.size, at, phase: task.phase, reason: why }
  updateTask(ctx.root, id, current => {
    if (current.size !== task.size || current.phase !== task.phase) {
      throw new Error("The task changed while its size was being raised; retry.")
    }
    current.size = input.size
    current.sizeChanges = [...(current.sizeChanges ?? []), change]
    current.decisions.push({ at, what: `Raised size from ${task.size} to ${input.size} in phase ${task.phase}`, why })
  })

  const pastPlan = task.phase !== "brief" && task.phase !== "plan"
  const notes: string[] = []
  if (pastPlan) {
    const approval = config.autoApprove.includes(input.size) || task.phases.plan?.approvedBy === "user"
      ? ""
      : " and the user must type /junto:approve"
    notes.push(
      `The ${input.size} lifecycle has a plan step this task skipped: fill brief.md, write plan.md (/junto:plan)${approval} `
      + `before the task can leave phase ${task.phase}. The task stays in ${task.phase}.`,
    )
  }
  if (input.size === "deep") {
    if (pastPlan) notes.push("Run /junto:panel on the plan now; deep tasks review the plan before building (advisory).")
    else notes.push("The deep lifecycle adds a panel phase after plan approval and a review phase after build.")
    if (task.phase === "build") notes.push("After build, advance to review and run /junto:panel on the implementation.")
    if (task.phase === "verify") notes.push("Run /junto:panel on the implementation before finishing (advisory).")
  }
  notes.push("Gate evidence already recorded is kept.")

  return `Raised task "${id}" from ${task.size} to ${input.size} in phase ${task.phase}. ${notes.join(" ")}`
}

export async function taskTool(ctx: ToolContext, input: TaskToolInput): Promise<string> {
  switch (input.action) {
    case "start": return start(ctx, input)
    case "finish": return finish(ctx)
    case "abandon": return abandon(ctx, input.reason)
    case "escalate": return escalate(ctx, input)
  }
}
