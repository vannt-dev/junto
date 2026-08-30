/** Chuẩn hoá về dấu `/`, bỏ tiền tố `./`. */
function normalize(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "")
}

/** Dịch glob sang regex. Hỗ trợ `**`, `*`, `?`. `*` không vượt qua dấu `/`. */
function globToRegExp(glob: string): RegExp {
  let out = "^"
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // `**/` nuốt luôn cả trường hợp không có thư mục nào
        if (glob[i + 2] === "/") { out += "(?:.*/)?"; i += 2 }
        else { out += ".*"; i += 1 }
      } else {
        out += "[^/]*"
      }
    } else if (c === "?") {
      out += "[^/]"
    } else {
      out += c!.replace(/[.+^${}()|[\]\\]/g, "\\$&")
    }
  }
  return new RegExp(`${out}$`)
}

/**
 * Sửa file này có làm hết hạn verdict không?
 * Trả false khi đường dẫn khớp bất kỳ mẫu nào trong staleIgnore.
 */
export function shouldStale(relPath: string, staleIgnore: string[]): boolean {
  const p = normalize(relPath)
  return !staleIgnore.some(pattern => globToRegExp(normalize(pattern)).test(p))
}
