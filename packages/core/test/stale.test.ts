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
