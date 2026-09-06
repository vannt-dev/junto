import { describe, expect, it } from "vitest"
import { cliBackend } from "../../src/backends/cli.js"

describe("cliBackend", () => {
  it("writes the joined prompt to stdin and returns trimmed stdout", async () => {
    const backend = cliBackend(["node", "-e", "process.stdin.resume(); let d=''; "
      + "process.stdin.on('data', c => d += c); "
      + "process.stdin.on('end', () => { console.log(d.trim()); })"], process.cwd())
    const result = await backend.complete({ systemPrompt: "sys", userPrompt: "user" })
    expect(result.text).toBe("sys\n\nuser")
  })

  it("always reports tokensUsed as 0", async () => {
    const backend = cliBackend(["node", "-e", "process.stdin.resume(); process.stdin.on('end', () => console.log('ok'))"], process.cwd())
    const result = await backend.complete({ systemPrompt: "s", userPrompt: "u" })
    expect(result.tokensUsed).toBe(0)
  })

  it("sets model to the resolved command name", async () => {
    const backend = cliBackend(["node", "-e", "process.stdin.resume(); process.stdin.on('end', () => console.log('ok'))"], process.cwd())
    const result = await backend.complete({ systemPrompt: "s", userPrompt: "u" })
    expect(result.model).toBe("node")
  })

  it("throws with the exit code and captured output on a non-zero exit", async () => {
    const backend = cliBackend(["node", "-e", "process.stdin.resume(); "
      + "process.stdin.on('end', () => { console.error('boom'); process.exit(2) })"], process.cwd())
    await expect(backend.complete({ systemPrompt: "s", userPrompt: "u" }))
      .rejects.toThrow(/exited 2.*boom/is)
  })

  it("throws naming the effective timeout when the process runs too long", async () => {
    const backend = cliBackend(["node", "-e", "setTimeout(() => {}, 60000)"], process.cwd())
    await expect(backend.complete({ systemPrompt: "s", userPrompt: "u", timeoutMs: 200 }))
      .rejects.toThrow(/timed out after 200ms/i)
  })

  it("throws before spawning when the command does not resolve on PATH", async () => {
    const backend = cliBackend(["junto-command-does-not-exist-abc123"], process.cwd())
    await expect(backend.complete({ systemPrompt: "s", userPrompt: "u" }))
      .rejects.toThrow(/does not exist or is not executable/i)
  })

  it("rejects a successful process that returns no response", async () => {
    const backend = cliBackend(["node", "-e", "process.stdin.resume(); process.stdin.on('end', () => {})"], process.cwd())
    await expect(backend.complete({ systemPrompt: "s", userPrompt: "u" }))
      .rejects.toThrow(/empty response/i)
  })

  it("rejects output larger than the junto-owned buffer limit", async () => {
    const backend = cliBackend(["node", "-e", "process.stdout.write('x'.repeat(1000001))"], process.cwd())
    await expect(backend.complete({ systemPrompt: "s", userPrompt: "u" }))
      .rejects.toThrow(/output exceeded 1000000 bytes/i)
  })

  it("normalizes failures that occur after executable resolution", async () => {
    const missingRoot = `${process.cwd()}-junto-does-not-exist`
    const backend = cliBackend(["node", "-e", "console.log('ok')"], missingRoot)
    await expect(backend.complete({ systemPrompt: "s", userPrompt: "u" }))
      .rejects.toThrow(/CLI backend "node" failed to start/i)
  })

  it.skipIf(process.platform === "win32")("reports signal termination without calling it a numeric exit", async () => {
    const backend = cliBackend(["node", "-e", "process.kill(process.pid, 'SIGTERM')"], process.cwd())
    await expect(backend.complete({ systemPrompt: "s", userPrompt: "u" }))
      .rejects.toThrow(/terminated by signal SIGTERM/i)
  })
})
