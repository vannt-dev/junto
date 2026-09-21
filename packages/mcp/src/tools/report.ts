import { exportReviewReport, readActiveId, readTask, reviewReport } from "@junto/core"
import type { ToolContext } from "../context.js"

export async function reportTool(ctx: ToolContext, input: { html?: boolean }): Promise<string> {
  const id = readActiveId(ctx.root)
  if (!id) throw new Error("No active task. Run /junto:start first.")
  readTask(ctx.root, id)
  const report = reviewReport(ctx.root, id)
  return JSON.stringify({ ...report, ...(input.html ? { html: exportReviewReport(ctx.root, id) } : {}) }, null, 2)
}
