import { describe, expect, it } from "vitest"
import { DEFAULT_STALE_IGNORE } from "../src/schema.js"
import { shouldStale } from "../src/stale.js"

const d = DEFAULT_STALE_IGNORE

describe("shouldStale with defaults", () => {
  it("marks source-file changes as stale", () => {
    expect(shouldStale("packages/core/src/gates.ts", d)).toBe(true)
    expect(shouldStale("src/app.py", d)).toBe(true)
  })

  it("ignores Markdown changes", () => {
    expect(shouldStale("README.md", d)).toBe(false)
    expect(shouldStale("packages/core/NOTES.md", d)).toBe(false)
  })

  it("ignores changes under docs/", () => {
    expect(shouldStale("docs/superpowers/plans/x.md", d)).toBe(false)
    expect(shouldStale("docs/diagram.svg", d)).toBe(false)
  })

  it("ignores changes under .junto/", () => {
    expect(shouldStale(".junto/config.json", d)).toBe(false)
    expect(shouldStale(".junto/tasks/t/plan.md", d)).toBe(false)
  })

  it("does not treat an embedded docs substring as the docs/ prefix", () => {
    expect(shouldStale("src/docs-helper.ts", d)).toBe(true)
    expect(shouldStale("mydocs/x.ts", d)).toBe(true)
  })

  it("does not include .markdown in the .md pattern", () => {
    expect(shouldStale("README.markdown", d)).toBe(true)
  })
})

describe("shouldStale with an empty ignore list", () => {
  it("marks every change as stale", () => {
    expect(shouldStale("README.md", [])).toBe(true)
  })
})

describe("path normalization", () => {
  it("accepts Windows backslashes", () => {
    expect(shouldStale("docs\\plans\\x.md", d)).toBe(false)
    expect(shouldStale("packages\\core\\src\\a.ts", d)).toBe(true)
  })

  it("removes the ./ prefix", () => {
    expect(shouldStale("./README.md", d)).toBe(false)
  })
})

describe("a single * does not cross /", () => {
  it("matches root files but not nested files with *.md", () => {
    expect(shouldStale("README.md", ["*.md"])).toBe(false)
    expect(shouldStale("docs/a.md", ["*.md"])).toBe(true)
  })

  it("matches direct docs children but not nested descendants with docs/*", () => {
    expect(shouldStale("docs/a.md", ["docs/*"])).toBe(false)
    expect(shouldStale("docs/sub/a.md", ["docs/*"])).toBe(true)
  })
})

describe("** in the middle of a pattern", () => {
  it("matches zero or many segments with a/**/b.md", () => {
    expect(shouldStale("a/b.md", ["a/**/b.md"])).toBe(false)
    expect(shouldStale("a/x/b.md", ["a/**/b.md"])).toBe(false)
    expect(shouldStale("a/x/y/b.md", ["a/**/b.md"])).toBe(false)
  })
})

describe("**/prefix/** pattern", () => {
  it("matches test directories anywhere without matching similar prefixes", () => {
    expect(shouldStale("test/b.md", ["**/test/**"])).toBe(false)
    expect(shouldStale("a/test/b.md", ["**/test/**"])).toBe(false)
    expect(shouldStale("a/test/x/b.md", ["**/test/**"])).toBe(false)
    expect(shouldStale("atest/b.md", ["**/test/**"])).toBe(true)
    expect(shouldStale("testb/a.md", ["**/test/**"])).toBe(true)
  })
})

describe("escaping regex-special characters in patterns", () => {
  it("treats dots and plus signs as literals", () => {
    expect(shouldStale("a.b/c+d.md", ["a.b/c+d.md"])).toBe(false)
    expect(shouldStale("aXb/cYd.md", ["a.b/c+d.md"])).toBe(true)
  })

  it("treats parentheses as literals", () => {
    expect(shouldStale("file(1).md", ["file(1).md"])).toBe(false)
    expect(shouldStale("fileX1X.md", ["file(1).md"])).toBe(true)
  })
})
