import { FastMCP, UserError, imageContent } from "./FastMCP.js";
import { z } from "zod";
import { test, expect, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { getRandomPort } from "get-port-please";
import { setTimeout as delay } from "timers/promises";
import {
  ErrorCode,
  LoggingMessageNotificationSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

const runWithTestServer = async ({
  run,
  start,
}: {
  start: () => Promise<FastMCP>;
  run: ({
    client,
    server,
  }: {
    client: Client;
    server: FastMCP;
  }) => Promise<void>;
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

    await run({ client, server });
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
          return String(args.a + args.b);
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

test("calls a tool", async () => {
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
          return String(args.a + args.b);
        },
      });

      return server;
    },
    run: async ({ client }) => {
      expect(
        await client.callTool({
          name: "add",
          arguments: {
            a: 1,
            b: 2,
          },
        }),
      ).toEqual({
        content: [{ type: "text", text: "3" }],
      });
    },
  });
});

test("returns a list", async () => {
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
        execute: async () => {
          return {
            content: [
              { type: "text", text: "a" },
              { type: "text", text: "b" },
            ],
          };
        },
      });

      return server;
    },
    run: async ({ client }) => {
      expect(
        await client.callTool({
          name: "add",
          arguments: {
            a: 1,
            b: 2,
          },
        }),
      ).toEqual({
        content: [
          { type: "text", text: "a" },
          { type: "text", text: "b" },
        ],
      });
    },
  });
});

test("returns an image", async () => {
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
        execute: async () => {
          return imageContent({
            buffer: Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
              "base64",
            ),
          });
        },
      });

      return server;
    },
    run: async ({ client }) => {
      expect(
        await client.callTool({
          name: "add",
          arguments: {
            a: 1,
            b: 2,
          },
        }),
      ).toEqual({
        content: [
          {
            type: "image",
            data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
            mimeType: "image/png",
          },
        ],
      });
    },
  });
});

test("handles UserError errors", async () => {
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
        execute: async () => {
          throw new UserError("Something went wrong");
        },
      });

      return server;
    },
    run: async ({ client }) => {
      expect(
        await client.callTool({
          name: "add",
          arguments: {
            a: 1,
            b: 2,
          },
        }),
      ).toEqual({
        content: [{ type: "text", text: "Something went wrong" }],
        isError: true,
      });
    },
  });
});

test("calling an unknown tool throws McpError with MethodNotFound code", async () => {
  await runWithTestServer({
    start: async () => {
      const server = new FastMCP({
        name: "Test",
        version: "1.0.0",
      });

      return server;
    },
    run: async ({ client }) => {
      try {
        await client.callTool({
          name: "add",
          arguments: {
            a: 1,
            b: 2,
          },
        });
      } catch (error) {
        expect(error).toBeInstanceOf(McpError);

        // @ts-expect-error - we know that error is an McpError
        expect(error.code).toBe(ErrorCode.MethodNotFound);
      }
    },
  });
});

test("tracks tool progress", async () => {
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
        execute: async (args, { reportProgress }) => {
          reportProgress({
            progress: 0,
            total: 10,
          });

          await delay(100);

          return String(args.a + args.b);
        },
      });

      return server;
    },
    run: async ({ client }) => {
      const onProgress = vi.fn();

      await client.callTool(
        {
          name: "add",
          arguments: {
            a: 1,
            b: 2,
          },
        },
        undefined,
        {
          onprogress: onProgress,
        },
      );

      expect(onProgress).toHaveBeenCalledTimes(1);
      expect(onProgress).toHaveBeenCalledWith({
        progress: 0,
        total: 10,
      });
    },
  });
});

test("sets logging levels", async () => {
  await runWithTestServer({
    start: async () => {
      const server = new FastMCP({
        name: "Test",
        version: "1.0.0",
      });

      return server;
    },
    run: async ({ client, server }) => {
      await client.setLoggingLevel("debug");

      expect(server.loggingLevel).toBe("debug");

      await client.setLoggingLevel("info");

      expect(server.loggingLevel).toBe("info");
    },
  });
});

test("sends logging messages to the client", async () => {
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
        execute: async (args, { log }) => {
          log.debug("debug message", {
            foo: "bar",
          });
          log.error("error message");
          log.info("info message");
          log.warn("warn message");

          return String(args.a + args.b);
        },
      });

      return server;
    },
    run: async ({ client }) => {
      const onLog = vi.fn();

      client.setNotificationHandler(
        LoggingMessageNotificationSchema,
        (message) => {
          if (message.method === "notifications/message") {
            onLog({
              level: message.params.level,
              ...(message.params.data ?? {}),
            });
          }
        },
      );

      await client.callTool({
        name: "add",
        arguments: {
          a: 1,
          b: 2,
        },
      });

      expect(onLog).toHaveBeenCalledTimes(4);
      expect(onLog).toHaveBeenNthCalledWith(1, {
        level: "debug",
        message: "debug message",
        context: {
          foo: "bar",
        },
      });
      expect(onLog).toHaveBeenNthCalledWith(2, {
        level: "error",
        message: "error message",
      });
      expect(onLog).toHaveBeenNthCalledWith(3, {
        level: "info",
        message: "info message",
      });
      expect(onLog).toHaveBeenNthCalledWith(4, {
        level: "warning",
        message: "warn message",
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

test("uses events to notify server of client connect/disconnect", async () => {
  const port = await getRandomPort();

  const server = new FastMCP({
    name: "Test",
    version: "1.0.0",
  });

  const onConnect = vi.fn();
  const onDisconnect = vi.fn();

  server.on("connect", onConnect);
  server.on("disconnect", onDisconnect);

  await server.start({
    transportType: "sse",
    sse: {
      endpoint: "/sse",
      port,
    },
  });

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

  await delay(100);

  expect(onConnect).toHaveBeenCalledTimes(1);
  expect(onDisconnect).toHaveBeenCalledTimes(0);

  expect(server.clients).toEqual([
    {
      type: "sse",
      transport: expect.any(SSEServerTransport),
    },
  ]);

  await client.close();

  await delay(100);

  expect(onConnect).toHaveBeenCalledTimes(1);
  expect(onDisconnect).toHaveBeenCalledTimes(1);

  await server.stop();
});
