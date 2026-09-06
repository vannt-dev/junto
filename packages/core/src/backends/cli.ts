import { execa } from "execa"
import { resolveExecutable } from "../exec.js"
import type { CompleteInput, CompleteResult, ModelBackend } from "./types.js"

const DEFAULT_CLI_TIMEOUT_MS = 120_000

export function cliBackend(argv: string[]): ModelBackend {
  return {
    async complete({ systemPrompt, userPrompt, timeoutMs }: CompleteInput): Promise<CompleteResult> {
      const [cmd, ...args] = argv
      if (cmd === undefined) throw new Error("CLI backend argv is empty.")
      if (!resolveExecutable(cmd, process.cwd())) {
        throw new Error(`CLI backend command "${cmd}" does not exist or is not executable. Install it and retry.`)
      }

      const effectiveTimeoutMs = timeoutMs ?? DEFAULT_CLI_TIMEOUT_MS
      const res = await execa(cmd, args, {
        input: `${systemPrompt}\n\n${userPrompt}`,
        timeout: effectiveTimeoutMs,
        reject: false,
        all: true,
      })

      if (res.timedOut) {
        throw new Error(`CLI backend "${cmd}" timed out after ${effectiveTimeoutMs}ms.`)
      }
      if (res.exitCode !== 0) {
        throw new Error(`CLI backend "${cmd}" exited ${res.exitCode}: ${res.all ?? ""}`)
      }
      return { text: (res.all ?? "").trim(), tokensUsed: 0, model: cmd }
    },
  }
}
