# junto — Thiết kế hệ thống

- **Ngày**: 2026-08-30
- **Trạng thái**: Đã duyệt (chờ lập kế hoạch triển khai)
- **Repo**: https://github.com/vannt-dev/junto

---

## 1. Bối cảnh & mục tiêu

junto là một workflow engine cho Claude Code: nó giữ trạng thái công việc bền qua các lượt hội thoại, chặn việc "hoàn thành" khi chưa có bằng chứng, và mời được model ngoài vào cho ý kiến.

Dự án khởi nguồn từ việc khảo sát [ccg-workflow](https://github.com/fengshao1227/ccg-workflow). CCG chứng minh ý tưởng hook + state injection + multi-model là đúng hướng, nhưng cách triển khai của nó có bốn vấn đề mà junto tồn tại để không lặp lại:

1. Ghi vào sáu thư mục trong `~/.claude/`, gỡ cài không bao giờ chắc sạch.
2. Tải binary về `chmod 755` chạy, không kiểm tra toàn vẹn, ưu tiên một CDN cá nhân trước nguồn chính thức.
3. Ship một skill sửa transcript của người dùng để vượt qua từ chối của model.
4. "Quality gate" thực chất là prompt bảo model tự chấm điểm mình.

### Mục tiêu

| # | Mục tiêu | Đo bằng |
|---|---|---|
| G1 | An toàn & minh bạch | Test ranh giới trong CI; không có binary tải về; không lưu bí mật |
| G2 | Đơn giản & dễ hiểu | 6 lệnh, 4 hook, 4 tool, 4 role, 4 luật. Đọc source là hiểu |
| G3 | State bền | Toàn bộ trạng thái trên đĩa; sống sót qua compaction |
| G4 | Kiểm chứng thật | Verdict do code sinh, không do model khai |

### Người dùng

Khởi đầu: team nhỏ của tác giả. Sau đó: công khai qua Claude Code plugin marketplace.

---

## 2. Nguyên tắc bất biến

Năm quy tắc này là hợp đồng của dự án. Chúng được viết vào README và ép bằng test.

**R1 — Chỉ ghi trong project.** junto chỉ tạo/sửa file bên trong `<project>/.junto/`. Không đụng `~/.claude`, không đụng `settings.json`, không sửa `.gitignore` gốc, không ghi bất cứ đâu ngoài phạm vi. Gỡ cài = gỡ plugin + xoá `.junto/`.

**R2 — Không tải mã về chạy.** Không binary, không `chmod`, không CDN, không `npx` lúc khởi động phiên. Mọi thứ chạy được đều nằm trong plugin đã cài.

**R3 — Không lưu bí mật.** junto không bao giờ ghi giá trị API key vào bất kỳ file nào. Cấu hình chỉ ghi *tên biến môi trường*.

**R4 — Không có skill nào vượt rào.** Không sửa transcript, không sửa cấu hình người dùng, không tìm cách vượt qua từ chối của model.

**R5 — Gate là tất định, panel là tư vấn.** Chỉ lệnh chạy được và mã thoát của nó mới có quyền chặn chuyển phase. Ý kiến của model — kể cả model ngoài — không bao giờ là gate.

---

## 3. Kiến trúc

Ba thành phần.

```
┌─ plugin/ ─────────────────────┐  claude plugin install junto@junto
│  commands/  6 file .md        │  Claude Code quản lý vòng đời
│  roles/     4 file .md        │
│  hooks/     4 file JS (bundle)│──┐ đọc/ghi
│  mcp/server.js (bundle)       │  │
└───────────────────────────────┘  │
                                   ▼
                       ┌─ <project>/.junto/ ─────┐
                       │  NGUỒN SỰ THẬT DUY NHẤT │
                       └─────────────────────────┘
                                   ▲
                                   │ ghi verdict, consult, task.json
                       ┌─ MCP server (stdio) ────┐
                       │  consult panel verify   │
                       │  advance                │
                       │  Backend: Api | Cli     │
                       └─────────────────────────┘
```

- **plugin/** — thứ Claude Code nạp. Hook là file JS đơn lẻ **zero dependency** (bundle sẵn bằng esbuild) vì hook chạy bằng `node file.js`, không qua `npm install`.
- **MCP server** — bundle thành một file JS nằm trong plugin. Đây là **nơi duy nhất** gọi ra mạng và **nơi duy nhất** được ghi vào `task.json` / `verdicts/`.
- **`.junto/`** — thư mục trạng thái trong repo người dùng. Toàn bộ bộ nhớ của hệ thống.

Không có state nào sống trong RAM giữa các lượt.

---

## 4. Trạng thái trên đĩa

```
.junto/
├── .gitignore                     # chỉ chứa "*.log" — do junto tạo
├── config.json                    # backend, role, gate. Commit. Team dùng chung
├── active                         # 1 dòng: id task đang chạy
├── roles/                         # role tự định nghĩa của project (tùy chọn)
├── tasks/<id>/
│   ├── task.json                  # ⭐ trạng thái
│   ├── brief.md
│   ├── plan.md
│   ├── context.jsonl              # {"file": "...", "reason": "..."} mỗi dòng
│   ├── verdicts/<gate>.json       # ⭐ bằng chứng
│   ├── verdicts/<gate>.log        # output thô (gitignore)
│   └── consults/NNN-<role>.md
└── archive/<id>/                  # task đã xong + summary.md
```

`id` có dạng `YYYY-MM-DD-<slug>`, ví dụ `2026-08-30-add-jwt`.

Nhiều task tồn tại song song được, nhưng **chỉ một active**.

### `task.json`

```jsonc
{
  "schemaVersion": 1,
  "id": "2026-08-30-add-jwt",
  "title": "Thêm xác thực JWT cho API",
  "size": "standard",
  "phase": "build",
  "baseCommit": "a1b2c3d",
  "createdAt": "2026-08-30T09:00:00Z",
  "updatedAt": "2026-08-30T10:04:23Z",
  "phases": {
    "brief":  { "status": "done",   "at": "2026-08-30T09:12:00Z" },
    "plan":   { "status": "done",   "at": "2026-08-30T09:40:00Z", "approvedBy": "user" },
    "build":  { "status": "active", "step": 2, "of": 4 },
    "verify": { "status": "pending" }
  },
  "gates": {
    "typecheck": { "required": true,  "verdict": null, "stale": false, "failStreak": 0 },
    "tests":     { "required": true,  "verdict": "verdicts/tests.json", "stale": true, "failStreak": 1 },
    "lint":      { "required": false, "verdict": null, "stale": false, "failStreak": 0 }
  },
  "decisions": [
    { "at": "2026-08-30T09:35:00Z", "what": "Dùng jose thay jsonwebtoken", "why": "ESM native, khỏi shim" }
  ],
  "consults": ["001-architect", "002-adversary"]
}
```

`baseCommit` được ghi lúc `/junto:start`, dùng cho `git diff` ở phase review.

### `config.json`

```jsonc
{
  "schemaVersion": 1,
  "backends": {
    "gpt-5":        { "kind": "api", "wire": "openai", "model": "gpt-5", "baseUrl": "https://api.openai.com/v1", "apiKeyEnv": "OPENAI_API_KEY" },
    "gemini-3-pro": { "kind": "api", "wire": "google", "model": "gemini-3-pro", "apiKeyEnv": "GEMINI_API_KEY" },
    "codex-cli":    { "kind": "cli", "argv": ["codex", "exec", "--json"] }
  },
  "roles": {
    "architect":  "gpt-5",
    "adversary":  "gemini-3-pro",
    "pragmatist": "gpt-5",
    "reviewer":   "gemini-3-pro"
  },
  "gates": {
    "typecheck": { "argv": ["pnpm", "typecheck"], "required": true },
    "tests":     { "argv": ["pnpm", "test"], "required": true, "timeoutMs": 300000 },
    "lint":      { "argv": ["pnpm", "lint"], "required": false },
    "audit":     { "argv": ["npm", "audit", "--json"], "required": false }
  },
  "maxConsultTokens": 4000,
  "autoApprove": []
}
```

**R3**: chỉ có `apiKeyEnv` (tên biến), không bao giờ có giá trị. MCP server đọc `process.env`.

---

## 5. Vòng đời task

Một vòng đời tuyến tính, ba cỡ. Cỡ chỉ quyết định phase nào bắt buộc.

| Cỡ | Phase bắt buộc | Dùng khi |
|---|---|---|
| `small` | build → verify | Sửa bug một file, đổi config, việc đã rõ |
| `standard` | brief → plan → approve → build → verify | Tính năng mới, nhiều file |
| `deep` | brief → panel → plan → approve → build → verify → review | Đổi kiến trúc, rủi ro cao |

### Bánh cóc một chiều

Cỡ **chỉ được nâng, không bao giờ hạ**: `small → standard → deep`. Khi nâng, ghi lý do vào `decisions[]` và quay lại phase `brief`. Không có đường ngược.

Điều này chặn kiểu hỏng phổ biến nhất: *"gần xong rồi, bỏ qua khâu plan cho nhanh"*.

`junto__advance` từ chối mọi yêu cầu hạ cỡ với lý do rõ ràng.

---

## 6. Luật chuyển phase

Toàn bộ chính sách nằm trong **một hàm thuần** trong `packages/core`:

```ts
type TransitionCheck = { ok: true } | { ok: false; reason: string }
function canEnter(task: Task, phase: Phase): TransitionCheck
```

Bốn luật, không hơn:

| # | Chuyển | Điều kiện |
|---|---|---|
| L1 | `brief → plan` | `brief.md` tồn tại và không rỗng |
| L2 | `plan → build` | `plan.md` tồn tại **và** `phases.plan.approvedBy === "user"` |
| L3 | `build → verify` | Không điều kiện |
| L4 | `verify → done` | Với mọi gate `required`: file verdict có `state === "pass"` **và** `task.gates[id].stale === false` |

**L2 là điểm dừng cứng duy nhất.** Engine không bao giờ tự đặt `approvedBy`; chỉ lệnh `/junto:approve` do người gõ mới đặt được.

Ngoại lệ duy nhất: `config.json` có thể liệt kê cỡ được bỏ qua L2, ví dụ `autoApprove: ["standard"]`. Danh sách mặc định rỗng, và tài liệu sẽ khuyến cáo không dùng. Lưu ý cỡ `small` không có phase `plan` nên L2 vốn đã không áp dụng cho nó — đưa `"small"` vào danh sách này là vô nghĩa.

Với cỡ `deep`, thêm hai phase tư vấn (`panel` sau `brief`, `review` sau `verify`). Chúng **không phải gate** (R5): chúng ghi consult ra đĩa và luôn cho đi tiếp. Giá trị của chúng là phát hiện, không phải quyền phủ quyết.

Hook và MCP tool gọi **cùng một** `canEnter`. Không có hai bản chính sách lệch nhau.

---

## 7. Bốn MCP tool

| Tool | Tham số | Làm gì | Ghi |
|---|---|---|---|
| `junto__consult` | `{ role, brief, files? }` | Hỏi một model ngoài | `consults/NNN-<role>.md` |
| `junto__panel` | `{ roles[], brief, files? }` | Hỏi nhiều model song song | nhiều consult |
| `junto__verify` | `{ gates? }` | **Tự chạy** lệnh gate | `verdicts/*`, `task.json` |
| `junto__advance` | `{ to }` | Xin chuyển phase | `task.json` hoặc trả lý do bị chặn |

Số lượng tool là một khoản chi phí context trong **mọi** phiên, nên bốn là trần.

### Vì sao verify phải là tool, không phải Bash

Nếu model chạy `pnpm test` bằng Bash rồi tự ghi verdict, nó có thể ghi bất cứ thứ gì. Bằng chứng do bên bị kiểm tra tạo ra không phải bằng chứng.

Do đó `junto__verify` **tự spawn** tiến trình, tự đọc mã thoát, tự ghi file. Model không nằm trong vòng lặp đó.

Và để điều đó có nghĩa, hook `guard.js` **chặn** ở `PreToolUse`: mọi `Edit` / `Write` / `MultiEdit` nhắm vào `.junto/**/task.json`, `.junto/**/verdicts/**`, `.junto/active` bị từ chối kèm lý do. Model đọc được, không ghi được.

Đây là chỗ **duy nhất** junto dùng quyền chặn của hook.

---

## 8. Backend

```ts
interface Backend {
  readonly id: string
  readonly kind: "api" | "cli"
  run(req: ConsultRequest, signal: AbortSignal): Promise<ConsultResult>
}

interface ConsultRequest {
  system: string                                    // nội dung role persona
  brief: string
  attachments: { path: string; content: string }[]
  maxTokens: number
}

interface ConsultResult {
  backendId: string
  text: string
  usage?: { input: number; output: number }
  ms: number
}
```

**`ApiBackend`** — một class, ba lớp wire mỏng: `openai` (tương thích cho phần lớn provider), `anthropic`, `google`. Chọn bằng `config.backends[].wire`.

**`CliBackend`** — spawn qua `execa` với **argv dạng mảng**, không bao giờ ghép chuỗi shell (loại bỏ command injection). Detached process group để timeout giết cả cây con; Windows dùng `taskkill /T /F`.

Adapter CLI ước tính ~150 dòng vì junto **không dựng live UI**. CCG cần nhiều mã hơn hẳn do phải parse stream event thời gian thực để đẩy lên một web server. junto chỉ cần output cuối cùng.

Backend nào cũng phải tôn trọng `AbortSignal` và `maxConsultTokens`.

---

## 9. Roles & panel

Bốn role, mỗi role một file markdown trong `plugin/roles/`. Project thêm role riêng bằng cách bỏ file vào `.junto/roles/` (trùng tên thì bản của project thắng).

| Role | Nhiệm vụ |
|---|---|
| `architect` | Cấu trúc, ranh giới, cái gì vỡ khi scale |
| `adversary` | Cố phá: edge case, failure mode, lỗ hổng |
| `pragmatist` | Cãi cho phương án nhỏ hơn, YAGNI |
| `reviewer` | Đọc diff, tìm khuyết điểm cụ thể |

`adversary` và `pragmatist` cố tình kéo ngược nhau.

### Panel không tổng hợp

`junto__panel` chạy song song bằng `Promise.allSettled`, mỗi backend timeout riêng, rồi trả về **nguyên văn từng phản hồi cạnh nhau**. Không vote, không trung bình, **không gọi thêm model thứ năm để tóm tắt**.

Lý do: Claude — bên gọi tool — đang giữ toàn bộ ngữ cảnh code, plan, task. Nó ở vị trí tốt hơn bất kỳ summarizer nào để thấy chỗ mâu thuẫn, và một summarizer sẽ san phẳng đúng cái cần giữ.

Mô tả tool nói rõ với Claude: *"Đừng lấy trung bình. Chỗ nào chúng mâu thuẫn, nêu ra và tự quyết định kèm lý do."*

**Hỏng một phần**: 1 trong 3 backend chết → trả về 2 cái chạy được **kèm ghi chú rõ backend nào hỏng vì sao**. Không bao giờ im lặng bỏ qua. Một panel thiếu người mà không nói là một panel nói dối.

Tối đa 4 role một lần gọi.

### Chi phí là opt-in

Cỡ `small` và `standard` **không gọi ra ngoài lần nào**. Chỉ `deep` có phase panel/review, hoặc khi người dùng gõ `/junto:panel`. Mỗi consult ghi `usage` vào file — `.junto/consults/` là sổ chi tiêu tự kiểm toán được.

---

## 10. Quality gates

Một gate là **một lệnh và một mã thoát**. `exitCode === 0` là pass. Chấm hết.

junto **không diễn giải output test**. Nó ghi mã thoát và output thô. Diễn giải là việc của Claude — nhưng Claude đọc bằng chứng có sẵn, không phải tự nhớ lại.

### Ba trạng thái

`pass` | `fail` | `skipped`

`skipped` là khi lệnh không chạy được (không cài tool, không có script). **`skipped` không bao giờ thoả mãn một gate `required`.**

Đây là chỗ phải trung thực nhất. Gate bảo mật bọc công cụ thật (`npm audit`, `pip-audit`, `gosec`, `semgrep`). Không có tool → báo `skipped` kèm lý do và lệnh cài đặt, **không trả về màu xanh**. Vì thế các gate bảo mật mặc định `required: false`; `/junto:start` in ra thứ cần cài để bật.

### Verdict

```jsonc
{
  "gate": "tests",
  "argv": ["pnpm", "test"],
  "cwd": "F:/ai-agent/junto",
  "exitCode": 1,
  "state": "fail",
  "startedAt": "2026-08-30T10:04:11Z",
  "durationMs": 12403,
  "outputTail": "…100 dòng cuối, tối đa 8KB…",
  "outputBytes": 148221,
  "outputFile": "verdicts/tests.log",
  "runner": "@junto/mcp@0.1.0"
}
```

Output đầy đủ ở `verdicts/<gate>.log`, **trên đĩa, không vào context**.

**Bất đối xứng có chủ ý**: gate `pass` trả về đúng một dòng, không kèm output. Gate `fail` trả về phần đuôi. Ngân sách context nên tiêu ở chỗ có thông tin.

### Bằng chứng hết hạn

Hook `guard.js` chạy ở `PostToolUse` sau mỗi `Edit`/`Write`/`MultiEdit`: đặt `stale: true` cho **mọi** gate. Không fingerprint, không thông minh hoá — sửa code là bằng chứng cũ hết giá trị.

Hệ quả: model không thể viện dẫn lần test trước khi nó vừa sửa file. Muốn qua L4 phải chạy lại thật.

### Chống đập đầu vào tường

`task.json` đếm `failStreak` mỗi gate. Đến lần thứ 3 liên tiếp cùng một gate fail, `junto__verify` chèn thêm:

> *"Gate `tests` đã fail 3 lần liên tiếp. Cân nhắc khả năng plan sai, không phải code sai."*

`failStreak` reset về 0 khi gate pass.

### Dò gate lúc khởi tạo

`/junto:start` trên project chưa có `config.json` đọc `package.json` scripts / `Cargo.toml` / `go.mod` / `Makefile`, đề xuất bộ gate, **hỏi người dùng xác nhận**, rồi ghi `config.json`. Chạy một lần duy nhất. Dò tìm cố tình đơn giản: chỉ khớp tên script quen thuộc rồi hỏi. Không đoán mò.

### Commit cái gì

| Commit | Bỏ qua |
|---|---|
| `config.json`, `brief.md`, `plan.md` | `verdicts/*.log` |
| `task.json`, `verdicts/*.json`, `consults/*.md` | |

`.junto/.gitignore` do junto tạo, chứa `*.log`. Không đụng `.gitignore` gốc (R1).

Hệ quả dễ chịu: PR kèm luôn hồ sơ quyết định — hỏi model nào, chúng bất đồng ở đâu, gate nào chạy, kết quả gì.

---

## 11. Bốn hook

| File | Sự kiện | Việc |
|---|---|---|
| `session.js` | `SessionStart` (startup / resume / **compact**) | Tiêm lại brief + plan + phase đầy đủ |
| `state.js` | `UserPromptSubmit` | Tiêm khối `<junto>` gọn (< ~120 token) |
| `handoff.js` | `PreToolUse` trên `Task` | Nhét `context.jsonl` vào prompt subagent |
| `guard.js` | `PreToolUse` + `PostToolUse` trên Edit/Write/MultiEdit | Chặn ghi vùng bảo vệ; đặt `stale` |

Khối tiêm mỗi lượt:

```
<junto task="add-jwt" phase="build" size="standard">
Plan đã duyệt. Bước 2/4.
Gates: tests(stale) typecheck(chưa) lint(tùy chọn)
Kế tiếp: xong bước 2 → gọi junto__verify
</junto>
```

Không có task active → hook không tiêm gì và thoát ngay.

---

## 12. Sáu lệnh

`start` · `plan` · `approve` · `panel` · `verify` · `finish`

| Lệnh | Việc |
|---|---|
| `/junto:start <brief>` | Tạo task, chọn cỡ, ghi `brief.md`, dò gate nếu chưa có config |
| `/junto:plan` | Sinh `plan.md` (cỡ `deep` gọi panel trước) |
| `/junto:approve` | **Chỉ người gõ.** Đặt `phases.plan.approvedBy = "user"` |
| `/junto:panel [roles]` | Gọi panel thủ công bất kỳ lúc nào |
| `/junto:verify` | Chạy gate |
| `/junto:finish` | Chuyển task sang `archive/`, ghi `summary.md` |

**Không có `/junto:status`** — khối `<junto>` đã tiêm mỗi lượt nên hỏi trạng thái là thừa. Một cơ chế tốt xoá bỏ nhu cầu về lệnh khác.

---

## 13. Đóng gói

```
junto/
├── .claude-plugin/{plugin.json, marketplace.json}
├── plugin/
│   ├── commands/           6 file .md
│   ├── roles/              4 file .md
│   ├── hooks/              ⚙ artifact build, có commit
│   ├── mcp/server.js       ⚙ artifact build, có commit
│   ├── hooks.json
│   └── .mcp.json
├── packages/core/          state, transitions, gate runner, schema
├── packages/mcp/           server + backends (publish npm)
├── src-hooks/              nguồn của 4 hook
└── docs/
```

Plugin **tự chứa hoàn toàn**:

```jsonc
// plugin/.mcp.json
{ "mcpServers": { "junto": { "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/mcp/server.js"] } } }
```

`claude plugin install junto@junto` là xong. Không `npx` lúc khởi động phiên, không tải gì, không binary, không version thứ hai để lệch (R2).

`@junto/mcp` vẫn publish npm cho ai muốn chạy độc lập — cùng source, hai đầu ra.

**Đánh đổi**: artifact build phải commit. CI có job bắt buộc rebuild rồi `git diff --exit-code`. Quên build lại là CI đỏ.

Một số phiên bản duy nhất cho cả plugin lẫn packages vì chúng luôn ship cùng nhau. Không dùng changesets.

Stack: TypeScript, pnpm workspace, esbuild (bundle), vitest (test), Node >= 20.

---

## 14. Bốn mốc

| Mốc | Nội dung | Dùng thật? |
|---|---|---|
| **M0** | `packages/core`: schema, `canEnter`, gate runner. Thuần hàm + test | Chưa |
| **M1** | Task engine **không có model ngoài**. 4 hook, tool `verify` + `advance`, cỡ `small`/`standard`, 5 lệnh `start`/`plan`/`approve`/`verify`/`finish` | **✅ Có** |
| **M2** | `ApiBackend`, tool `consult` + `panel`, 4 role, lệnh thứ 6 `/junto:panel` | Có model ngoài |
| **M3** | `CliBackend`, cỡ `deep` với phase panel/review, dò gate hoàn chỉnh | Đủ tính năng |
| **M4** | Docs, marketplace, ví dụ, phát hành công khai | Người ngoài dùng được |

M1 giao **G1, G2, G3 và phần lớn G4 mà không cần một API key nào**. Toàn bộ máy móc đa model đắt đỏ nằm ở M2–M3.

Thứ tự này cố ý đặt phần rủi ro nhất ra sau bằng chứng: nếu dùng M1 vài tuần mà không ai gọi model ngoài, đó là phát hiện quý — biết trước khi tiêu công.

---

## 15. Kiểm thử & CI

- **`canEnter`** — bảng test vét cạn: 4 luật × tổ hợp phase/gate/size. Hàm thuần nên test tầm thường, và nó là toàn bộ chính sách.
- **Gate runner** — chạy lệnh **thật** nhỏ (`node -e "process.exit(1)"`), không mock. Test timeout, output khổng lồ bị cắt đúng, ba trạng thái.
- **`CliBackend`** — spawn script `node -e` kiểm tra timeout giết được **cả cây process**. Chạy trên **cả Windows và Linux** trong CI.
- **`ApiBackend`** — dựng http server cục bộ bằng `node:http`, không mock `fetch`.
- **Hook** — mỗi hook là hàm `(input) => output`. Test hàm; file bọc ngoài 3 dòng.
- **Test ranh giới (R1)** — chạy trọn vòng đời task trong thư mục tạm, chụp filesystem trước/sau, khẳng định **không gì ngoài `<tmp>/.junto/` bị tạo hay sửa**. Biến R1 từ lời hứa README thành điều kiện CI.
- **Test artifact đồng bộ** — rebuild hook + server, `git diff --exit-code`.

CI: typecheck → unit test → test ranh giới → test artifact, ma trận `ubuntu-latest` + `windows-latest`.

---

## 16. Ngoài phạm vi

Ghi ra để không bị đưa vào lúc nửa đường:

- **Live UI / web server.** Không có. Đây là nguồn gốc phần lớn độ phức tạp của CCG và của lỗ hổng bind `:0` không auth.
- **Thư viện domain knowledge.** Không tự tiêm 100 file kiến thức. Dùng skill của Claude Code.
- **Strategy engine chọn bằng heuristic.** Ba cỡ do người chọn, không phải mười strategy do máy đoán.
- **Nhiều task active cùng lúc.**
- **Quản lý bí mật.** junto đọc env var, không bao giờ lưu (R3).
- **Tự động commit / tự động push.** junto không chạy lệnh git thay đổi trạng thái repo.
- **Đồng bộ cấu hình cấp máy.** Không có `~/.junto/` (R1).

---

## 17. Rủi ro đã biết

| Rủi ro | Mức | Xử lý |
|---|---|---|
| Format plugin & hook event của Claude Code còn thay đổi | Trung bình | Giữ bề mặt tiếp xúc nhỏ: 4 hook, 1 `.mcp.json`. Ghim phiên bản Claude Code tối thiểu trong README |
| `guard.js` chặn ghi gây khó chịu khi MCP server chết | Trung bình | Vẫn sửa được `task.json` bằng editor thường. Thông báo chặn nói rõ cách xử lý |
| `stale` toàn bộ quá thô, phải chạy lại gate nhiều | Thấp | Chấp nhận ở v1. Chỉ tinh chỉnh nếu dùng thật thấy phiền |
| Artifact build commit dễ lệch với source | Trung bình | Job CI bắt buộc `git diff --exit-code` |
| Format output CLI của Codex/Gemini đổi | Thấp | `CliBackend` chỉ đọc stdout cuối, không parse stream. `ApiBackend` là mặc định |
| Panel tốn tiền ngoài dự kiến | Thấp | Mặc định `small`/`standard` không gọi ra ngoài. `usage` ghi vào mọi consult |

---

## 18. Bước kế tiếp

Chuyển sang kỹ năng lập kế hoạch triển khai (`writing-plans`) để tạo kế hoạch chi tiết cho **M0 + M1**.
