import type { GateState, Phase, Size, Task } from "./schema.js"

export type TransitionCheck = { ok: true } | { ok: false; reason: string }

export interface TransitionContext {
  /** brief.md tồn tại và có nội dung sau khi trim */
  briefNonEmpty: boolean
  /** plan.md tồn tại */
  planExists: boolean
  /** config.autoApprove */
  autoApprove: Size[]
  /** tên gate -> state đọc từ file verdict; null nếu chưa có verdict */
  verdictStates: Record<string, GateState | null>
}

const SMALL_PHASES: Phase[] = ["build", "verify", "done"]
const FULL_PHASES: Phase[] = ["brief", "plan", "build", "verify", "done"]

/**
 * Phase bắt buộc theo cỡ.
 * M1: `deep` giống `standard`. Phase panel/review của `deep` thuộc M3.
 */
export function requiredPhases(size: Size): Phase[] {
  return size === "small" ? [...SMALL_PHASES] : [...FULL_PHASES]
}

export function canEnter(task: Task, to: Phase, ctx: TransitionContext): TransitionCheck {
  const order = requiredPhases(task.size)
  const from = order.indexOf(task.phase)
  const target = order.indexOf(to)

  if (target === -1) return { ok: false, reason: `Phase "${to}" không có trong vòng đời của cỡ "${task.size}".` }
  if (from === -1) return { ok: false, reason: `Task đang ở phase "${task.phase}", không thuộc vòng đời của cỡ "${task.size}".` }
  if (target !== from + 1) {
    return { ok: false, reason: `Chỉ chuyển được sang phase liền kề. Đang ở "${task.phase}", muốn sang "${to}".` }
  }

  // L1
  if (task.phase === "brief" && to === "plan") {
    if (!ctx.briefNonEmpty) return { ok: false, reason: "brief.md chưa tồn tại hoặc còn rỗng." }
    return { ok: true }
  }

  // L2 — điểm dừng cứng duy nhất
  if (task.phase === "plan" && to === "build") {
    if (!ctx.planExists) return { ok: false, reason: "plan.md chưa tồn tại." }
    if (ctx.autoApprove.includes(task.size)) return { ok: true }
    if (task.phases.plan?.approvedBy !== "user") {
      return { ok: false, reason: "Plan chưa được duyệt. Người dùng phải gõ /junto:approve — model không tự duyệt được." }
    }
    return { ok: true }
  }

  // L3
  if (task.phase === "build" && to === "verify") return { ok: true }

  // L4
  if (task.phase === "verify" && to === "done") {
    const blocked: string[] = []
    for (const [name, status] of Object.entries(task.gates)) {
      if (!status.required) continue
      if (status.verdict === null) { blocked.push(`${name} (chưa chạy)`); continue }
      if (status.stale) { blocked.push(`${name} (bằng chứng hết hạn — code đã đổi)`); continue }
      const state = ctx.verdictStates[name] ?? null
      if (state !== "pass") blocked.push(`${name} (${state ?? "không đọc được verdict"})`)
    }
    if (blocked.length > 0) {
      return { ok: false, reason: `Gate bắt buộc chưa đạt: ${blocked.join(", ")}. Chạy /junto:verify.` }
    }
    return { ok: true }
  }

  return { ok: false, reason: `Không có luật cho chuyển "${task.phase}" -> "${to}".` }
}
