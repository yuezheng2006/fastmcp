/**
 * This is a complete example of an MCP server.
 */
import { FastMCP } from "../FastMCP.js";
import { z } from "zod";

const server = new FastMCP({
  name: "Addition",
  version: "1.0.0",
});

server.addTool({
  name: "add",
  description: "Add two numbers",
  parameters: z.object({
    a: z.number(),
    b: z.number(),
  }),
  execute: async (args) => {
    return String(args.a + args.b);
  },
});

server.start({
  transportType: "stdio",
});
