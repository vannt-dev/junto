import {
  captureReviewFingerprint, captureSourceFingerprint, CliReviewProvider, OpenCodeReviewProvider, ScopedReviewProvider, readActiveId, readConfig, readTask, resolveReviewScopes, runGate, runReviewGate, updateTask,
  writeReviewBackground,
} from "@junto/core"
import type { Config, GateSpec, Task, VerdictFile } from "@junto/core"
import type { ToolContext } from "../context.js"
import { persistTaskPolicy, resolveTaskPolicy } from "./policy.js"

const FAIL_STREAK_HINT_AT = 3

function render(v: VerdictFile, streak: number): string {
  const head = `## ${v.gate} - ${v.state} (${v.durationMs}ms)`

  if (v.state === "pass") {
    // Successful output is intentionally terse.
    return `${head}\nPassed. Full output: ${v.outputFile}.`
  }

  if (v.state === "skipped") {
    return `${head}\n${v.reason ?? "Could not run."}\n`
      + `Note: "skipped" does not satisfy a required gate and is not a pass.`
  }

  const hint = streak >= FAIL_STREAK_HINT_AT
    ? `\n\nWarning: gate "${v.gate}" has failed ${streak} consecutive times. `
      + "Consider whether the plan, rather than the code, is wrong."
    : ""

  return `${head}\nexit ${v.exitCode}. ${v.outputBytes} bytes; full output: ${v.outputFile}.\n\n`
    + `\`\`\`\n${v.outputTail}\n\`\`\`${hint}`
}

async function runReview(ctx: ToolContext, task: Task, name: string, spec: GateSpec, config: Config): Promise<VerdictFile> {
  const backgroundFile = writeReviewBackground(ctx.root, task.id, task.title)
  const fingerprint = captureReviewFingerprint(ctx.root, task, config)
  const scopes = await resolveReviewScopes(ctx.root, task.baseCommit)
  const provider = new ScopedReviewProvider(spec.provider === "cli" ? new CliReviewProvider(spec.timeoutMs)
    : new OpenCodeReviewProvider({ ...(spec.timeoutMs ? { timeoutMs: spec.timeoutMs } : {}) }), scopes)
  return runReviewGate({
    root: ctx.root,
    taskId: task.id,
    name,
    reviewFingerprint: fingerprint,
    provider: { async review(context) {
      const result = await provider.review(context)
      const current = readTask(ctx.root, task.id)
      if (captureReviewFingerprint(ctx.root, current, readConfig(ctx.root)) !== fingerprint
        || (current.gates[name]?.invalidationVersion ?? 0) !== (task.gates[name]?.invalidationVersion ?? 0)) {
        result.error = { kind: "incomplete", message: "Source, policy or requirement context changed during review; rerun the review." }
      }
      return result
    } },
    context: {
      ...(backgroundFile ? { backgroundFile } : {}),
    },
    ...(spec.failOn ? { failOn: spec.failOn } : {}),
    runner: ctx.runner,
  })
}

export async function verifyTool(ctx: ToolContext, input: { gates?: string[] }): Promise<string> {
  const id = readActiveId(ctx.root)
  if (id === null) throw new Error("No active task. Run /junto:start first.")

  const config = readConfig(ctx.root)
  const stored = readTask(ctx.root, id)
  const { task, unknownGates } = await resolveTaskPolicy(ctx.root, stored, config)
  persistTaskPolicy(ctx.root, stored, task)
  if (unknownGates.length) throw new Error(`Rules reference unconfigured gates: ${unknownGates.join(", ")}. Fix .junto/config.json.`)
  const names = input.gates ?? Object.keys(task.gates)

  const sections: string[] = []
  for (const name of names) {
    const spec = config.gates[name]
    const status = task.gates[name]
    if (!spec || !status) {
      sections.push(`## ${name} - not present in .junto/config.json; skipped.`)
      continue
    }

    // A failed scope lookup or spawn must not leave a previous passing verdict current.
    const started = updateTask(ctx.root, id, current => { const gate = current.gates[name]; if (gate) gate.stale = true })
    status.invalidationVersion = started.gates[name]?.invalidationVersion ?? 0

    const sourceFingerprint = spec.type === "review" ? null : captureSourceFingerprint(ctx.root, config, spec)
    const verdict = spec.type === "review"
      ? await runReview(ctx, task, name, spec, config)
      : await runGate({ root: ctx.root, taskId: id, name, spec, runner: ctx.runner, ...(sourceFingerprint ? { sourceFingerprint } : {}) })

    // Build the path from the validated name rather than coupling to outputFile formatting.
    status.verdict = `verdicts/${name}.json`
    status.stale = false
    // Only real failures affect the streak. A skipped gate neither increments nor resets it.
    if (verdict.state === "pass") status.failStreak = 0
    else if (verdict.state === "fail") status.failStreak = status.failStreak + 1
    sections.push(render(verdict, status.failStreak))

    // Hash outside the task lock: edit hooks wait only briefly for it. Source edited while the gate
    // ran leaves a result that may describe neither version; advance rechecks the fingerprint later.
    const latest = readConfig(ctx.root)
    const latestSpec = latest.gates[name]
    const changedDuringRun = (verdict.reviewFingerprint !== undefined
      && captureReviewFingerprint(ctx.root, readTask(ctx.root, id), latest) !== verdict.reviewFingerprint)
      || (verdict.sourceFingerprint !== undefined && (latestSpec === undefined
        || captureSourceFingerprint(ctx.root, latest, latestSpec) !== verdict.sourceFingerprint))

    // Persist after every gate so a later failure cannot discard completed evidence.
    updateTask(ctx.root, id, current => {
      const version = current.gates[name]?.invalidationVersion ?? 0
      current.gates[name] = { ...status, invalidationVersion: version, stale: version !== status.invalidationVersion || changedDuringRun }
    })
  }

  return sections.join("\n\n")
}
