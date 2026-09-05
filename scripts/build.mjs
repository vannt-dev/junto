import { mkdirSync } from "node:fs"
import { build } from "esbuild"

const shared = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  banner: { js: "import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);" },
}

mkdirSync("plugin/hooks", { recursive: true })
mkdirSync("plugin/mcp", { recursive: true })

for (const name of ["state", "guard", "session", "handoff"]) {
  await build({ ...shared, entryPoints: [`src-hooks/${name}.ts`], outfile: `plugin/hooks/${name}.js` })
}

// A dedicated entry always starts the server without fragile import.meta.url matching.
await build({ ...shared, entryPoints: ["packages/mcp/src/main.ts"], outfile: "plugin/mcp/server.js" })

console.log("build complete: 4 hooks + 1 MCP server")
