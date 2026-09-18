import { describe, expect, it } from "vitest"
import { ChangedFileResolver } from "../src/changes.js"

describe("ChangedFileResolver", () => {
  const resolver = new ChangedFileResolver()

  it("parses standard git diff name-status output", () => {
    const rawOutput = `
M\tsrc/auth/service.ts
A\tsrc/auth/token.ts
D\tsrc/legacy.ts
R100\told/path.ts\tnew/path.ts
`
    const files = resolver.parseNameStatusOutput(rawOutput)
    expect(files).toEqual([
      { path: "src/auth/service.ts", status: "modified" },
      { path: "src/auth/token.ts", status: "added" },
      { path: "src/legacy.ts", status: "deleted" },
      { path: "new/path.ts", status: "renamed" },
    ])
  })

  it("filters out ignored files", () => {
    const rawOutput = `
M\tsrc/index.ts
M\tnode_modules/pkg/index.js
A\t.junto/tasks/1.json
A\tdist/bundle.js
`
    const files = resolver.parseNameStatusOutput(rawOutput)
    expect(files).toEqual([
      { path: "src/index.ts", status: "modified" },
    ])
  })

  it("supports custom ignore patterns", () => {
    const rawOutput = `
M\tsrc/index.ts
M\tdocs/readme.md
`
    const files = resolver.parseNameStatusOutput(rawOutput, ["docs/**"])
    expect(files).toEqual([
      { path: "src/index.ts", status: "modified" },
    ])
  })

  it("deduplicates identical paths", () => {
    const rawOutput = `
M\tsrc/index.ts
M\tsrc/index.ts
`
    const files = resolver.parseNameStatusOutput(rawOutput)
    expect(files).toHaveLength(1)
  })
})
