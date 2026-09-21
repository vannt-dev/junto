import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "vitest"
import { OpenCodeReviewProvider } from "../src/review.js"

// Opt in with a locally installed binary; CI never downloads a reviewer at runtime.
it.skipIf(!process.env.OCR_SMOKE_BIN)("previews a real repository through the installed OCR binary", async () => {
  const root = mkdtempSync(join(tmpdir(), "junto-real-ocr-"))
  try {
    execFileSync("git", ["init", "-q", root])
    execFileSync("git", ["-c", "user.name=Smoke", "-c", "user.email=smoke@example.invalid", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-qm", "fixture"], { cwd: root })
    const provider = new OpenCodeReviewProvider({ executable: process.env.OCR_SMOKE_BIN, timeoutMs: 30_000 })
    expect(await provider.isAvailable(root)).toBe(true)
    expect((await provider.delegatePreview({ root })).reviewable).toEqual([])
    writeFileSync(join(root, "sample.py"), "def greet(name):\n    return 'Hello ' + name\n")
    expect((await provider.delegatePreview({ root })).reviewable.map(f => f.path)).toEqual(["sample.py"])
    const rules = await provider.delegateRules({ root }, ["sample.py"])
    expect(rules.schema_version).toBe("1")
    expect(rules.groups.flatMap(group => group.files)).toContain("sample.py")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
