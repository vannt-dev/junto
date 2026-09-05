import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import { resolveContext } from "./context.js"
import { advanceTool } from "./tools/advance.js"
import { taskTool } from "./tools/task.js"
import { verifyTool } from "./tools/verify.js"

const taskInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    title: z.string(),
    size: z.enum(["small", "standard", "deep"]),
    gates: z.array(z.string()).optional(),
  }),
  z.object({ action: z.literal("switch"), id: z.string() }),
  z.object({ action: z.literal("finish") }),
])
const verifyInput = z.object({ gates: z.array(z.string()).optional() })
const advanceInput = z.object({ to: z.enum(["brief", "plan", "build", "verify", "done"]) })

const TOOLS = [
  {
    name: "junto__task",
    description:
      "Manage the junto task lifecycle: start creates a task, switch changes the active task, "
      + "and finish archives a completed task. This tool cannot approve plans.",
    inputSchema: {
      type: "object" as const,
      properties: {
        action: { type: "string", enum: ["start", "switch", "finish"] },
        title: { type: "string", description: "Required when action=start" },
        size: { type: "string", enum: ["small", "standard", "deep"], description: "Required when action=start" },
        id: { type: "string", description: "Required when action=switch" },
        gates: { type: "array", items: { type: "string" }, description: "Optional: enable only these gates" },
      },
      required: ["action"],
    },
  },
  {
    name: "junto__verify",
    description:
      "Run quality gates for the active task and persist evidence in .junto/. "
      + "The tool runs commands itself; self-reported results are not evidence.",
    inputSchema: {
      type: "object" as const,
      properties: { gates: { type: "array", items: { type: "string" }, description: "Omit to run all gates" } },
    },
  },
  {
    name: "junto__advance",
    description: "Request a transition for the active task; returns a reason when prerequisites are unmet.",
    inputSchema: {
      type: "object" as const,
      properties: { to: { type: "string", enum: ["brief", "plan", "build", "verify", "done"] } },
      required: ["to"],
    },
  },
]

export function createServer(): Server {
  const server = new Server({ name: "junto", version: "0.1.0" }, { capabilities: { tools: {} } })

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const ctx = resolveContext(process.cwd())
      const args = request.params.arguments ?? {}
      let text: string
      switch (request.params.name) {
        case "junto__task": text = await taskTool(ctx, taskInput.parse(args)); break
        case "junto__verify": text = await verifyTool(ctx, verifyInput.parse(args)); break
        case "junto__advance": text = await advanceTool(ctx, advanceInput.parse(args)); break
        default: throw new Error(`Unknown tool: ${request.params.name}`)
      }
      return { content: [{ type: "text", text }] }
    } catch (error) {
      return { content: [{ type: "text", text: (error as Error).message }], isError: true }
    }
  })

  return server
}
