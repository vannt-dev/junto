import { describe, expect, it } from "vitest"
import { DEFAULT_STALE_IGNORE } from "../src/schema.js"
import { shouldStale } from "../src/stale.js"

const d = DEFAULT_STALE_IGNORE

describe("shouldStale với mặc định", () => {
  it("sửa file nguồn thì làm hết hạn", () => {
    expect(shouldStale("packages/core/src/gates.ts", d)).toBe(true)
    expect(shouldStale("src/app.py", d)).toBe(true)
  })

  it("sửa markdown thì không", () => {
    expect(shouldStale("README.md", d)).toBe(false)
    expect(shouldStale("packages/core/NOTES.md", d)).toBe(false)
  })

  it("sửa trong docs/ thì không", () => {
    expect(shouldStale("docs/superpowers/plans/x.md", d)).toBe(false)
    expect(shouldStale("docs/diagram.svg", d)).toBe(false)
  })

  it("sửa trong .junto/ thì không", () => {
    expect(shouldStale(".junto/config.json", d)).toBe(false)
    expect(shouldStale(".junto/tasks/t/plan.md", d)).toBe(false)
  })

  it("tên chỉ chứa docs không phải tiền tố docs/ thì vẫn hết hạn", () => {
    expect(shouldStale("src/docs-helper.ts", d)).toBe(true)
    expect(shouldStale("mydocs/x.ts", d)).toBe(true)
  })

  it("đuôi .markdown không nằm trong mẫu .md", () => {
    expect(shouldStale("README.markdown", d)).toBe(true)
  })
})

describe("shouldStale với danh sách rỗng", () => {
  it("mọi thứ đều làm hết hạn", () => {
    expect(shouldStale("README.md", [])).toBe(true)
  })
})

describe("chuẩn hoá đường dẫn", () => {
  it("chấp nhận dấu gạch chéo ngược của Windows", () => {
    expect(shouldStale("docs\\plans\\x.md", d)).toBe(false)
    expect(shouldStale("packages\\core\\src\\a.ts", d)).toBe(true)
  })

  it("bỏ tiền tố ./", () => {
    expect(shouldStale("./README.md", d)).toBe(false)
  })
})

describe("* đơn không vượt qua /", () => {
  it("*.md khớp file root nhưng không khớp trong thư mục", () => {
    expect(shouldStale("README.md", ["*.md"])).toBe(false)
    expect(shouldStale("docs/a.md", ["*.md"])).toBe(true)
  })

  it("docs/* khớp trong docs nhưng không khớp trong thư mục con", () => {
    expect(shouldStale("docs/a.md", ["docs/*"])).toBe(false)
    expect(shouldStale("docs/sub/a.md", ["docs/*"])).toBe(true)
  })
})

describe("** ở giữa pattern", () => {
  it("a/**/b.md khớp zero-segment và nhiều segment", () => {
    expect(shouldStale("a/b.md", ["a/**/b.md"])).toBe(false)
    expect(shouldStale("a/x/b.md", ["a/**/b.md"])).toBe(false)
    expect(shouldStale("a/x/y/b.md", ["a/**/b.md"])).toBe(false)
  })
})

describe("**/prefix/** pattern", () => {
  it("**/test/** khớp test ở bất kỳ đâu nhưng không khớp tiền tố giống test", () => {
    expect(shouldStale("test/b.md", ["**/test/**"])).toBe(false)
    expect(shouldStale("a/test/b.md", ["**/test/**"])).toBe(false)
    expect(shouldStale("a/test/x/b.md", ["**/test/**"])).toBe(false)
    expect(shouldStale("atest/b.md", ["**/test/**"])).toBe(true)
    expect(shouldStale("testb/a.md", ["**/test/**"])).toBe(true)
  })
})

describe("escape ký tự regex-đặc-biệt trong pattern", () => {
  it("dot literal: a.b/c+d.md khớp chính nó nhưng không khớp wildcard", () => {
    expect(shouldStale("a.b/c+d.md", ["a.b/c+d.md"])).toBe(false)
    expect(shouldStale("aXb/cYd.md", ["a.b/c+d.md"])).toBe(true)
  })

  it("parentheses literal: file(1).md khớp chính nó nhưng không khớp wildcard", () => {
    expect(shouldStale("file(1).md", ["file(1).md"])).toBe(false)
    expect(shouldStale("fileX1X.md", ["file(1).md"])).toBe(true)
  })
})
