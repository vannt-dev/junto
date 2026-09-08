import { existsSync, readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const html = readFileSync("site/index.html", "utf-8")
const plugin = JSON.parse(readFileSync(".claude-plugin/plugin.json", "utf-8")) as { version: string }

describe("public site", () => {
  it("ships every local asset referenced by the landing page", () => {
    for (const asset of ["site/styles.css", "site/app.js", "site/favicon.svg", "site/.nojekyll"]) {
      expect(existsSync(asset), `missing ${asset}`).toBe(true)
    }
  })

  it("documents the public marketplace installation path", () => {
    expect(html).toContain("claude plugin marketplace add vannt-dev/junto")
    expect(html).toContain("claude plugin install junto@junto")
  })

  it("keeps the displayed release version aligned with the plugin", () => {
    expect(html).toContain(`data-version>v${plugin.version}<`)
  })

  it("links to the public source and latest release", () => {
    expect(html).toContain("https://github.com/vannt-dev/junto")
    expect(html).toContain("https://github.com/vannt-dev/junto/releases/latest")
  })
})
