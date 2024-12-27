import { FastMCP } from "./FastMCP.js";
import { z } from "zod";
import { test, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { getRandomPort } from "get-port-please";
import { EventSource } from "eventsource";

// @ts-expect-error - figure out how to use --experimental-eventsource with vitest
global.EventSource = EventSource;

const runWithTestServer = async ({
  run,
  start,
}: {
  start: () => Promise<FastMCP>;
  run: ({ client }: { client: Client }) => Promise<void>;
}) => {
  const port = await getRandomPort();

  const server = await start();

  await server.start({
    transportType: "sse",
    sse: {
      endpoint: "/sse",
      port,
    },
  });

  try {
    const client = new Client(
      {
        name: "example-client",
        version: "1.0.0",
      },
      {
        capabilities: {},
      },
    );

    const transport = new SSEClientTransport(
      new URL(`http://localhost:${port}/sse`),
    );

    await client.connect(transport);

    await run({ client });
  } finally {
    await server.stop();
  }

  return port;
};

test("adds tools", async () => {
  await runWithTestServer({
    start: async () => {
      const server = new FastMCP({
        name: "Test",
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
          return args.a + args.b;
        },
      });

      return server;
    },
    run: async ({ client }) => {
      expect(await client.listTools()).toEqual({
        tools: [
          {
            name: "add",
            description: "Add two numbers",
            inputSchema: {
              additionalProperties: false,
              $schema: "http://json-schema.org/draft-07/schema#",
              type: "object",
              properties: {
                a: { type: "number" },
                b: { type: "number" },
              },
              required: ["a", "b"],
            },
          },
        ],
      });
    },
  });
});

test('calls a tool', async () => {
  await runWithTestServer({
    start: async () => {
      const server = new FastMCP({
        name: "Test",
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
          return args.a + args.b;
        },
      });

      return server;
    },
    run: async ({ client }) => {
      expect(await client.callTool({
        name: "add",
        arguments: {
          a: 1,
          b: 2,
        },
      })).toEqual({
        content: [{ type: "text", text: "3" }],
      });
    },
  });
});

test("adds resources", async () => {
  await runWithTestServer({
    start: async () => {
      const server = new FastMCP({
        name: "Test",
        version: "1.0.0",
      });

      server.addResource({
        uri: "file:///logs/app.log",
        name: "Application Logs",
        mimeType: "text/plain",
        async load() {
          return {
            text: "Example log content",
          };
        },
      });

      return server;
    },
    run: async ({ client }) => {
      expect(await client.listResources()).toEqual({
        resources: [
          {
            uri: "file:///logs/app.log",
            name: "Application Logs",
            mimeType: "text/plain",
          },
        ],
      });
    },
  });
});

test("adds prompts", async () => {
  await runWithTestServer({
    start: async () => {
      const server = new FastMCP({
        name: "Test",
        version: "1.0.0",
      });

      server.addPrompt({
        name: "git-commit",
        description: "Generate a Git commit message",
        arguments: [
          {
            name: "changes",
            description: "Git diff or description of changes",
            required: true,
          },
        ],
        load: async (args) => {
          return `Generate a concise but descriptive commit message for these changes:\n\n${args.changes}`;
        },
      });

      return server;
    },
    run: async ({ client }) => {
      expect(await client.listPrompts()).toEqual({
        prompts: [
          {
            name: "git-commit",
            description: "Generate a Git commit message",
            arguments: [
              {
                name: "changes",
                description: "Git diff or description of changes",
                required: true,
              },
            ],
          },
        ],
      });
    },
  });
});
