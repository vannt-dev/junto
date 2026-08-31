# junto

Công cụ quản lý vòng đời task cho Claude Code: một `packages/core` thuần chính sách,
một MCP server, và các hook. Ngôn ngữ làm việc của dự án là **tiếng Việt** — comment,
commit message, tài liệu, báo cáo đều tiếng Việt.

Tài liệu thẩm quyền:
- Thiết kế (ràng buộc): `docs/superpowers/specs/2026-08-30-junto-design.md`
- Kế hoạch M0+M1: `docs/superpowers/plans/2026-08-30-junto-m0-m1.md`

Khi spec và plan mâu thuẫn, **spec thắng**.

## Toolchain — đọc trước khi gõ lệnh

`pnpm` **KHÔNG** có trên PATH của máy này. Mọi lệnh pnpm phải có tiền tố `corepack`:

```bash
corepack pnpm install
corepack pnpm test                                    # vitest toàn workspace
corepack pnpm vitest run packages/core/test/x.test.ts # test một file
corepack pnpm typecheck                               # tsc -b
corepack pnpm --filter @junto/core add <pkg>
```

- KHÔNG cài pnpm global. KHÔNG sửa `"packageManager": "pnpm@10.17.1"` trong root `package.json`.
- Node trên máy: v24.13.0. Windows 11, có cả PowerShell lẫn Bash.
- `tsc -b` cần root `tsconfig.json` làm solution file. **Thêm package mới thì phải thêm nó vào
  mảng `references`** của file đó, nếu không typecheck bỏ sót package im lặng.
- CI phải chạy Node **20.19+ hoặc 22.12+**, KHÔNG dùng 20.0–20.18 — `vite` (transitive qua
  vitest) đòi `^20.19.0 || >=22.12.0`, chặt hơn `engines.node` của repo.
- pnpm 10 chặn postinstall mặc định (`Ignored build scripts: esbuild`). Script build gọi esbuild
  sẽ vấp: hoặc khai `pnpm.onlyBuiltDependencies: ["esbuild"]`, hoặc gọi esbuild qua API JS.

## Ràng buộc bất di bất dịch

Đây là các bất biến của spec. Vi phạm một trong số này là lỗi, bất kể task đang làm gì.

- **R1 — Chỉ ghi trong project.** Không code nào được tạo/sửa file ngoài `<project>/.junto/`.
  Không đụng `~/.claude`, `settings.json`, hay `.gitignore` gốc của người dùng.
- **R2 — Không tải mã về chạy.** Không binary, không `chmod`, không CDN, không `npx` lúc khởi
  động phiên.
- **R3 — Không lưu bí mật.** Không ghi giá trị API key vào bất kỳ file nào.
- **R5 — Gate tất định, panel tư vấn.** Chỉ mã thoát của lệnh mới chặn được chuyển phase.
- **Spawn luôn dùng argv dạng mảng.** Không bao giờ ghép chuỗi shell.
- **`SCHEMA_VERSION = 1`.** File có `schemaVersion` lớn hơn → tool từ chối kèm thông báo rõ ràng,
  không đoán, không tự nâng cấp.
- **`canEnter()` phải thuần.** Mọi dữ kiện filesystem truyền vào qua tham số; không đọc đĩa,
  không `Date.now()`, không `process.env` bên trong.
- **Chính sách chỉ có một bản.** Mọi luật chuyển phase sống trong `packages/core/src/transitions.ts`
  dưới dạng hàm thuần. KHÔNG cài lại luật trong `advance.ts` hay bất kỳ tầng gọi nào — chính sách
  rò ra hai nơi là lỗi thiết kế, không phải tiện lợi.
- **`.gitattributes` phải giữ dòng `* text=auto eol=lf`.** CI chạy ma trận Windows + Linux và có
  job `git diff --exit-code` trên artifact build; thiếu dòng này job đó đỏ vĩnh viễn.

## Quy ước code

- TypeScript strict, `noUncheckedIndexedAccess: true` (`tsconfig.base.json`). Rào chắn này bật
  **cố ý** — không né bằng non-null assertion (`x!`). Dùng `charAt`, kiểm tra `undefined`, hoặc
  thu hẹp kiểu cho đúng.
- ESM: `"type": "module"`, import nội bộ luôn có đuôi `.js` (`./paths.js`), import Node luôn có
  tiền tố `node:` (`node:fs`).
- Không default export. `src/index.ts` chỉ gồm các dòng `export * from "./<module>.js"`.
- Comment tiếng Việt, giải thích *tại sao*, không mô tả lại code.
- Test đặt ở `packages/*/test/**/*.test.ts` (xem `vitest.config.ts`). Test tạo thư mục tạm phải
  dọn trong `afterEach` — không bỏ rác lại trong `os.tmpdir()`.

## Quy ước commit

- Conventional commit, **subject tiếng Việt**: `feat(core): ...`, `test(core): ...`, `docs: ...`
- **KHÔNG** thêm trailer `Co-Authored-By:` hay `Claude-Session:`. Không ngoại lệ.
- `git add` phạm vi hẹp theo đúng thứ mình sửa; không `git add -A`.
- `.superpowers/` nằm trong `.gitignore` — file quy trình không bao giờ được commit.
- Không tạo branch mới, không merge, không push nếu không được yêu cầu rõ ràng.

## Quy trình đang chạy

Dự án đang thực thi plan M0+M1 bằng quy trình subagent-driven development. Trạng thái sống ở
`.superpowers/sdd/2026-08-30-junto-m0-m1/progress.md` (ledger — git-ignored).

**Bắt đầu một phiên mới thì đọc ledger đó trước.** Nó ghi task nào đã xong, task nào đang dở ở
bước nào, và mọi Ruling đã quyết. Các Ruling là ràng buộc đã chốt — không bàn lại.

Cảnh báo đã ghi nhận: các con số "Expected: N PASS" trong plan **không đáng tin** (sai ở 3/3 task
đã kiểm). Đừng dùng làm tiêu chí nghiệm thu, và tuyệt đối không sửa test để khớp chúng.
