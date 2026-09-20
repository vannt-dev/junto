import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { SkillResolver } from "../src/skills.js"

describe("SkillResolver", () => {
  let tmpRoot: string

  const addSkill = (name: string, frontmatter: string, body = "Body.") => {
    const dir = join(tmpRoot, "skills", name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\n${frontmatter}\n---\n\n${body}\n`, "utf-8")
  }

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "junto-skills-"))
    addSkill(
      "typescript-engineering",
      "description: TypeScript engineering standards and patterns.",
      "# TypeScript Engineering\n\nAlways use strict null checks.",
    )
    addSkill(
      "security-review",
      "description: Review security-sensitive code.\nappliesTo:\n  - \"**/auth/**\"\n  - \"**/security/**\"\ntags: [security, backend]",
    )
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  it("resolves skill content and frontmatter description", () => {
    const [skill] = new SkillResolver([tmpRoot]).resolve(["typescript-engineering"])
    expect(skill?.name).toBe("typescript-engineering")
    expect(skill?.found).toBe(true)
    expect(skill?.description).toBe("TypeScript engineering standards and patterns.")
    expect(skill?.content).toContain("Always use strict null checks.")
  })

  it("reports a missing skill with found=false instead of pretending it exists", () => {
    const [skill] = new SkillResolver([tmpRoot]).resolve(["non-existent-skill"])
    expect(skill?.name).toBe("non-existent-skill")
    expect(skill?.found).toBe(false)
    expect(skill?.content).toContain("Skill definition not found on disk.")
  })

  it("never resolves names that could escape the skill roots", () => {
    const skills = new SkillResolver([tmpRoot]).resolve(["../secrets", "a/b", ".."])
    expect(skills.every(s => !s.found)).toBe(true)
  })

  it("reads appliesTo and tags from frontmatter", () => {
    const [skill] = new SkillResolver([tmpRoot]).resolve(["security-review"])
    expect(skill?.appliesTo).toEqual(["**/auth/**", "**/security/**"])
    expect(skill?.tags).toEqual(["security", "backend"])
  })

  it("reads appliesTo and tags from the skillset.json registry when SKILL.md has none", () => {
    addSkill("python-engineering", "description: Python.")
    writeFileSync(join(tmpRoot, "skillset.json"), JSON.stringify({
      schemaVersion: 2,
      version: "1.0.0",
      skills: [
        { name: "python-engineering", category: "stack", appliesTo: ["**/*.py", "**/pyproject.toml"], tags: ["python"] },
        { name: "../evil", category: "stack", appliesTo: ["**"], tags: ["x"] },
        { name: "typescript-engineering", category: "stack", appliesTo: "not-a-list", tags: [1, "ts"] },
      ],
    }))
    const resolver = new SkillResolver([tmpRoot])
    const [python] = resolver.resolve(["python-engineering"])
    expect(python?.appliesTo).toEqual(["**/*.py", "**/pyproject.toml"])
    expect(python?.tags).toEqual(["python"])
    expect(resolver.resolveForFiles(["svc/app.py"]).map(s => s.name)).toEqual(["python-engineering"])
    // Malformed registry entries are ignored rather than trusted.
    const [ts] = resolver.resolve(["typescript-engineering"])
    expect(ts?.appliesTo).toEqual([])
    expect(ts?.tags).toEqual(["ts"])
  })

  it("survives a broken skillset.json", () => {
    writeFileSync(join(tmpRoot, "skillset.json"), "{ not json")
    expect(new SkillResolver([tmpRoot]).resolve(["typescript-engineering"])[0]?.found).toBe(true)
  })

  it("lists skills present under the roots", () => {
    expect(new SkillResolver([tmpRoot]).list()).toEqual(["security-review", "typescript-engineering"])
  })

  it("selects skills by appliesTo in addition to explicit ones, without loading the rest", () => {
    const resolver = new SkillResolver([tmpRoot])
    const names = resolver.resolveForFiles(["src/auth/login.ts"], ["typescript-engineering"]).map(s => s.name)
    expect(names).toEqual(["typescript-engineering", "security-review"])
    expect(resolver.resolveForFiles(["src/ui/button.ts"]).map(s => s.name)).toEqual([])
  })
})
