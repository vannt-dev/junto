import { expect, it } from "vitest"
import { SCHEMA_VERSION } from "../src/index.js"

it("phơi ra SCHEMA_VERSION", () => {
  expect(SCHEMA_VERSION).toBe(1)
})
