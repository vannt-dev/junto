import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { SkillResolver } from "../src/skills.js"

describe("SkillResolver", () => {
  let tmpRoot: string

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "junto-skills-"))
    const skillDir = join(tmpRoot, "skills", "typescript-engineering")
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
name: typescript-engineering
description: TypeScript engineering standards and patterns.
---

# TypeScript Engineering

Always use strict null checks.
`,
      "utf-8",
    )
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  it("resolves skill content and frontmatter description", () => {
    const resolver = new SkillResolver([tmpRoot])
    const skills = resolver.resolve(["typescript-engineering"])

    expect(skills).toHaveLength(1)
    expect(skills[0].name).toBe("typescript-engineering")
    expect(skills[0].description).toBe("TypeScript engineering standards and patterns.")
    expect(skills[0].content).toContain("Always use strict null checks.")
  })

  it("returns fallback for missing skills without crashing", () => {
    const resolver = new SkillResolver([tmpRoot])
    const skills = resolver.resolve(["non-existent-skill"])

    expect(skills).toHaveLength(1)
    expect(skills[0].name).toBe("non-existent-skill")
    expect(skills[0].content).toContain("Skill definition not found on disk.")
  })
})
