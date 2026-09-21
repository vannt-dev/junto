import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { taskDir } from "./paths.js"

export interface ReviewEvent {
  id: string
  timestamp: string
  gate: string
  type: "review.started" | "review.completed" | "review.failed"
  state?: string
}

export function appendReviewEvent(root: string, taskId: string, event: Omit<ReviewEvent, "id" | "timestamp">): void {
  const dir = taskDir(root, taskId)
  mkdirSync(dir, { recursive: true })
  appendFileSync(join(dir, "review-events.jsonl"), `${JSON.stringify({ ...event, id: randomUUID(), timestamp: new Date().toISOString() })}\n`, "utf-8")
}

export function reviewReport(root: string, taskId: string): { taskId: string; events: unknown[]; reviews: unknown[] } {
  const dir = taskDir(root, taskId)
  const eventsPath = join(dir, "review-events.jsonl")
  const events = existsSync(eventsPath) ? readFileSync(eventsPath, "utf-8").split("\n").filter(Boolean).map(line => JSON.parse(line) as unknown) : []
  const verdicts = join(dir, "verdicts")
  const reviews = existsSync(verdicts) ? readdirSync(verdicts).filter(file => file.endsWith(".review.json")).sort().map(file => {
    const name = file.slice(0, -".review.json".length)
    const verdict = join(verdicts, `${name}.json`)
    return { gate: name, verdict: existsSync(verdict) ? JSON.parse(readFileSync(verdict, "utf-8")) as unknown : null,
      review: JSON.parse(readFileSync(join(verdicts, file), "utf-8")) as unknown }
  }) : []
  return { taskId, events, reviews }
}

export function renderReviewReport(report: ReturnType<typeof reviewReport>): string {
  const escaped = JSON.stringify(report, null, 2).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch)
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>Junto review report</title>'
    + '<style>body{font:16px system-ui;max-width:1000px;margin:40px auto;padding:20px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style>'
    + `<h1>Junto review evidence</h1><p>Stored evidence only. Use task status to check current transition eligibility.</p><pre>${escaped}</pre></html>`
}

export function exportReviewReport(root: string, taskId: string): string {
  const report = reviewReport(root, taskId)
  const path = join(taskDir(root, taskId), "review-report.html")
  writeFileSync(path, renderReviewReport(report), "utf-8")
  return path
}
