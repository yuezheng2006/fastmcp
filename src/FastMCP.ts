import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  LoggingLevel,
  LoggingLevelSchema,
  LoggingMessageNotificationSchema,
  McpError,
  NotificationSchema,
  ReadResourceRequestSchema,
  ServerCapabilities,
  SetLevelRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { z } from "zod";
import http from "http";

abstract class FastMCPError extends Error {
  public constructor(message?: string) {
    super(message);
    this.name = new.target.name;
  }
}

type Extra = unknown;

type Extras = Record<string, Extra>;

class UnexpectedStateError extends FastMCPError {
  public extras?: Extras;

  public constructor(message: string, extras?: Extras) {
    super(message);
    this.name = new.target.name;
    this.extras = extras;
  }
}

export class UserError extends UnexpectedStateError {}

type ToolParameters = z.ZodTypeAny;

type Literal = boolean | null | number | string | undefined;

type SerializableValue =
  | Literal
  | SerializableValue[]
  | { [key: string]: SerializableValue };

type Progress = {
  /**
   * The progress thus far. This should increase every time progress is made, even if the total is unknown.
   */
  progress: number;
  /**
   * Total number of items to process (or total progress required), if known.
   */
  total?: number;
};

type Context = {
  reportProgress: (progress: Progress) => Promise<void>;
  log: {
    debug: (message: string, data?: SerializableValue) => void;
    error: (message: string, data?: SerializableValue) => void;
    info: (message: string, data?: SerializableValue) => void;
    warn: (message: string, data?: SerializableValue) => void;
  };
};

type Tool<Params extends ToolParameters = ToolParameters> = {
  name: string;
  description?: string;
  parameters?: Params;
  execute: (args: z.infer<Params>, context: Context) => Promise<unknown>;
};

type Resource = {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  load: () => Promise<{ text: string } | { blob: string }>;
};

type PromptArgument = Readonly<{
  name: string;
  description?: string;
  required?: boolean;
}>;

type ArgumentsToObject<T extends PromptArgument[]> = {
  [K in T[number]["name"]]: Extract<
    T[number],
    { name: K }
  >["required"] extends true
    ? string
    : string | undefined;
};

type Prompt<
  Arguments extends PromptArgument[] = PromptArgument[],
  Args = ArgumentsToObject<Arguments>,
> = {
  name: string;
  description?: string;
  arguments?: Arguments;
  load: (args: Args) => Promise<string>;
};

type ServerOptions = {
  name: string;
  version: `${number}.${number}.${number}`;
};

export class FastMCP {
  #tools: Tool[];
  #resources: Resource[];
  #prompts: Prompt[];
  #server: Server | null = null;
  #options: ServerOptions;
  #loggingLevel: LoggingLevel = "info";

  constructor(public options: ServerOptions) {
    this.#options = options;
    this.#tools = [];
    this.#resources = [];
    this.#prompts = [];
  }

  private setupHandlers(server: Server) {
    this.setupErrorHandling(server);

    if (this.#tools.length) {
      this.setupToolHandlers(server);
    }

    if (this.#resources.length) {
      this.setupResourceHandlers(server);
    }

    if (this.#prompts.length) {
      this.setupPromptHandlers(server);
    }

    server.setRequestHandler(SetLevelRequestSchema, (request) => {
      this.#loggingLevel = request.params.level;

      return {};
    });
  }

  private setupErrorHandling(server: Server) {
    server.onerror = (error) => {
      console.error("[MCP Error]", error);
    };
    process.on("SIGINT", async () => {
      await server.close();
      process.exit(0);
    });
  }

  public get loggingLevel() {
    return this.#loggingLevel;
  }

  private setupToolHandlers(server: Server) {
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: this.#tools.map((tool) => {
          return {
            name: tool.name,
            description: tool.description,
            inputSchema: tool.parameters
              ? zodToJsonSchema(tool.parameters)
              : undefined,
          };
        }),
      };
    });

    server.setRequestHandler(
      CallToolRequestSchema,
      async (request, ...extra) => {
        const tool = this.#tools.find(
          (tool) => tool.name === request.params.name,
        );

        if (!tool) {
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`,
          );
        }

        let args: any = undefined;

        if (tool.parameters) {
          const parsed = tool.parameters.safeParse(request.params.arguments);

          if (!parsed.success) {
            throw new McpError(
              ErrorCode.InvalidRequest,
              `Invalid ${request.params.name} arguments`,
            );
          }

          args = parsed.data;
        }

        const progressToken = request.params?._meta?.progressToken;

        let result: any;

        try {
          const reportProgress = async (progress: Progress) => {
            await server.notification({
              method: "notifications/progress",
              params: {
                ...progress,
                progressToken,
              },
            });
          };

          const log = {
            debug: (message: string, context?: SerializableValue) => {
              server.sendLoggingMessage({
                level: "debug",
                data: {
                  message,
                  context,
                },
              });
            },
            error: (message: string, context?: SerializableValue) => {
              server.sendLoggingMessage({
                level: "error",
                data: {
                  message,
                  context,
                },
              });
            },
            info: (message: string, context?: SerializableValue) => {
              server.sendLoggingMessage({
                level: "info",
                data: {
                  message,
                  context,
                },
              });
            },
            warn: (message: string, context?: SerializableValue) => {
              server.sendLoggingMessage({
                level: "warning",
                data: {
                  message,
                  context,
                },
              });
            },
          };

          result = await tool.execute(args, {
            reportProgress,
            log,
          });
        } catch (error) {
          if (error instanceof UserError) {
            return {
              content: [{ type: "text", text: error.message }],
              isError: true,
            };
          }

          return {
            content: [{ type: "text", text: `Error: ${error}` }],
            isError: true,
          };
        }

        if (typeof result === "string") {
          return {
            content: [{ type: "text", text: result }],
          };
        }

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      },
    );
  }

  private setupResourceHandlers(server: Server) {
    server.setRequestHandler(ListResourcesRequestSchema, async () => {
      return {
        resources: this.#resources.map((resource) => {
          return {
            uri: resource.uri,
            name: resource.name,
            mimeType: resource.mimeType,
          };
        }),
      };
    });

    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const resource = this.#resources.find(
        (resource) => resource.uri === request.params.uri,
      );

      if (!resource) {
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown resource: ${request.params.uri}`,
        );
      }

      let result: Awaited<ReturnType<Resource["load"]>>;

      try {
        result = await resource.load();
      } catch (error) {
        throw new McpError(
          ErrorCode.InternalError,
          `Error reading resource: ${error}`,
          {
            uri: resource.uri,
          },
        );
      }

      return {
        contents: [
          {
            uri: resource.uri,
            mimeType: resource.mimeType,
            ...result,
          },
        ],
      };
    });
  }

  private setupPromptHandlers(server: Server) {
    server.setRequestHandler(ListPromptsRequestSchema, async () => {
      return {
        prompts: this.#prompts.map((prompt) => {
          return {
            name: prompt.name,
            description: prompt.description,
            arguments: prompt.arguments,
          };
        }),
      };
    });

    server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const prompt = this.#prompts.find(
        (prompt) => prompt.name === request.params.name,
      );

      if (!prompt) {
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown prompt: ${request.params.name}`,
        );
      }

      const args = request.params.arguments;

      if (prompt.arguments) {
        for (const arg of prompt.arguments) {
          if (arg.required && !(args && arg.name in args)) {
            throw new McpError(
              ErrorCode.InvalidRequest,
              `Missing required argument: ${arg.name}`,
            );
          }
        }
      }

      let result: Awaited<ReturnType<Prompt["load"]>>;

      try {
        result = await prompt.load(args as Record<string, string | undefined>);
      } catch (error) {
        throw new McpError(
          ErrorCode.InternalError,
          `Error loading prompt: ${error}`,
        );
      }

      return {
        description: prompt.description,
        messages: [
          {
            role: "user",
            content: { type: "text", text: result },
          },
        ],
      };
    });
  }

  public addTool<Params extends ToolParameters>(tool: Tool<Params>) {
    this.#tools.push(tool as unknown as Tool);
  }

  public addResource(resource: Resource) {
    this.#resources.push(resource);
  }

  public addPrompt<const Args extends PromptArgument[]>(prompt: Prompt<Args>) {
    this.#prompts.push(prompt);
  }

  #httpServer: http.Server | null = null;

  public async start(
    options:
      | { transportType: "stdio" }
      | {
          transportType: "sse";
          sse: { endpoint: `/${string}`; port: number };
        } = {
      transportType: "stdio",
    },
  ) {
    const capabilities: ServerCapabilities = {};

    if (this.#tools.length) {
      capabilities.tools = {};
    }

    if (this.#resources.length) {
      capabilities.resources = {};
    }

    if (this.#prompts.length) {
      capabilities.prompts = {};
    }

    capabilities.logging = {};

    this.#server = new Server(
      { name: this.#options.name, version: this.#options.version },
      { capabilities },
    );

    this.setupHandlers(this.#server);

    if (options.transportType === "stdio") {
      const transport = new StdioServerTransport();

      await this.#server.connect(transport);

      console.error(`server is running on stdio`);
    } else if (options.transportType === "sse") {
      let activeTransport: SSEServerTransport | null = null;

      /**
       * Adopted from https://dev.classmethod.jp/articles/mcp-sse/
       */
      this.#httpServer = http.createServer(async (req, res) => {
        if (req.method === "GET" && req.url === options.sse.endpoint) {
          const transport = new SSEServerTransport("/messages", res);

          activeTransport = transport;

          if (!this.#server) {
            throw new Error("Server not initialized");
          }

          await this.#server.connect(transport);

          res.on("close", () => {
            console.log("SSE connection closed");
            if (activeTransport === transport) {
              activeTransport = null;
            }
          });

          this.startSending(transport);
          return;
        }

        if (req.method === "POST" && req.url?.startsWith("/messages")) {
          if (!activeTransport) {
            res.writeHead(400).end("No active transport");
            return;
          }
          await activeTransport.handlePostMessage(req, res);
          return;
        }

        res.writeHead(404).end();
      });

      this.#httpServer.listen(options.sse.port, "0.0.0.0");

      console.error(
        `server is running on SSE at http://localhost:${options.sse.port}${options.sse.endpoint}`,
      );
    } else {
      throw new Error("Invalid transport type");
    }
  }

  /**
   * @see https://dev.classmethod.jp/articles/mcp-sse/
   */
  private async startSending(transport: SSEServerTransport) {
    try {
      await transport.send({
        jsonrpc: "2.0",
        method: "sse/connection",
        params: { message: "SSE Connection established" },
      });

      let messageCount = 0;
      const interval = setInterval(async () => {
        messageCount++;

        const message = `Message ${messageCount} at ${new Date().toISOString()}`;

        try {
          await transport.send({
            jsonrpc: "2.0",
            method: "sse/message",
            params: { data: message },
          });

          console.log(`Sent: ${message}`);

          if (messageCount === 10) {
            clearInterval(interval);

            await transport.send({
              jsonrpc: "2.0",
              method: "sse/complete",
              params: { message: "Stream completed" },
            });
            console.log("Stream completed");
          }
        } catch (error) {
          console.error("Error sending message:", error);
          clearInterval(interval);
        }
      }, 1000);
    } catch (error) {
      console.error("Error in startSending:", error);
    }
  }

  public async stop() {
    if (this.#httpServer) {
      this.#httpServer.close();
    }
  }
}
