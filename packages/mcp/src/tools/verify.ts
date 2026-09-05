import { readActiveId, readConfig, readTask, runGate, writeTask } from "@junto/core"
import type { VerdictFile } from "@junto/core"
import type { ToolContext } from "../context.js"

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

export async function verifyTool(ctx: ToolContext, input: { gates?: string[] }): Promise<string> {
  const id = readActiveId(ctx.root)
  if (id === null) throw new Error("No active task. Run /junto:start first.")

  const config = readConfig(ctx.root)
  const task = readTask(ctx.root, id)
  const names = input.gates ?? Object.keys(task.gates)

  const sections: string[] = []
  for (const name of names) {
    const spec = config.gates[name]
    const status = task.gates[name]
    if (!spec || !status) {
      sections.push(`## ${name} - not present in .junto/config.json; skipped.`)
      continue
    }

    const verdict = await runGate({ root: ctx.root, taskId: id, name, spec, runner: ctx.runner })

    // Build the path from the validated name rather than coupling to outputFile formatting.
    status.verdict = `verdicts/${name}.json`
    status.stale = false
    // Only real failures affect the streak. A skipped gate neither increments nor resets it.
    if (verdict.state === "pass") status.failStreak = 0
    else if (verdict.state === "fail") status.failStreak = status.failStreak + 1
    sections.push(render(verdict, status.failStreak))

    // Persist after every gate so a later failure cannot discard completed evidence.
    writeTask(ctx.root, task)
  }

  return sections.join("\n\n")
}
