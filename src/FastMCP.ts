import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  ServerCapabilities,
  SetLevelRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod";
import { readFile } from "fs/promises";
import { fileTypeFromBuffer } from "file-type";
import { startSSEServer, type SSEServer } from "mcp-proxy";
import { StrictEventEmitter } from "strict-event-emitter-types";
import { EventEmitter } from "events";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

type FastMCPEvents = {
  connect: (event: { transport: Transport }) => void;
  disconnect: (event: { transport: Transport }) => void;
};

/**
 * Generates an image content object from a URL, file path, or buffer.
 */
export const imageContent = async (
  input: { url: string } | { path: string } | { buffer: Buffer },
): Promise<ImageContent> => {
  let rawData: Buffer;

  if ("url" in input) {
    const response = await fetch(input.url);

    if (!response.ok) {
      throw new Error(`Failed to fetch image from URL: ${response.statusText}`);
    }

    rawData = Buffer.from(await response.arrayBuffer());
  } else if ("path" in input) {
    rawData = await readFile(input.path);
  } else if ("buffer" in input) {
    rawData = input.buffer;
  } else {
    throw new Error(
      "Invalid input: Provide a valid 'url', 'path', or 'buffer'",
    );
  }

  const mimeType = await fileTypeFromBuffer(rawData);

  const base64Data = rawData.toString("base64");

  return {
    type: "image",
    data: base64Data,
    mimeType: mimeType?.mime ?? "image/png",
  } as const;
};

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

/**
 * An error that is meant to be surfaced to the user.
 */
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

type TextContent = {
  type: "text";
  text: string;
};

const TextContentZodSchema = z
  .object({
    type: z.literal("text"),
    /**
     * The text content of the message.
     */
    text: z.string(),
  })
  .strict() satisfies z.ZodType<TextContent>;

type ImageContent = {
  type: "image";
  data: string;
  mimeType: string;
};

const ImageContentZodSchema = z
  .object({
    type: z.literal("image"),
    /**
     * The base64-encoded image data.
     */
    data: z.string().base64(),
    /**
     * The MIME type of the image. Different providers may support different image types.
     */
    mimeType: z.string(),
  })
  .strict() satisfies z.ZodType<ImageContent>;

type Content = TextContent | ImageContent;

const ContentZodSchema = z.discriminatedUnion("type", [
  TextContentZodSchema,
  ImageContentZodSchema,
]) satisfies z.ZodType<Content>;

type ContentResult = {
  content: Content[];
  isError?: boolean;
};

const ContentResultZodSchema = z
  .object({
    content: ContentZodSchema.array(),
    isError: z.boolean().optional(),
  })
  .strict() satisfies z.ZodType<ContentResult>;

type Tool<Params extends ToolParameters = ToolParameters> = {
  name: string;
  description?: string;
  parameters?: Params;
  execute: (
    args: z.infer<Params>,
    context: Context,
  ) => Promise<string | ContentResult | TextContent | ImageContent>;
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

type LoggingLevel =
  | "debug"
  | "info"
  | "notice"
  | "warning"
  | "error"
  | "critical"
  | "alert"
  | "emergency";

export class FastMCP extends (EventEmitter as {
  new (): StrictEventEmitter<EventEmitter, FastMCPEvents>;
}) {
  #tools: Tool[];
  #resources: Resource[];
  #prompts: Prompt[];
  #server: Server | null = null;
  #options: ServerOptions;
  #loggingLevel: LoggingLevel = "info";

  constructor(public options: ServerOptions) {
    super();

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

  /**
   * Returns the current logging level.
   */
  public get loggingLevel(): LoggingLevel {
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

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
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

      let result: ContentResult;

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

        const maybeStringResult = await tool.execute(args, {
          reportProgress,
          log,
        });

        if (typeof maybeStringResult === "string") {
          result = ContentResultZodSchema.parse({
            content: [{ type: "text", text: maybeStringResult }],
          });
        } else if ("type" in maybeStringResult) {
          result = ContentResultZodSchema.parse({
            content: [maybeStringResult],
          });
        } else {
          result = ContentResultZodSchema.parse(maybeStringResult);
        }
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

      return result;
    });
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

  /**
   * Adds a tool to the server.
   */
  public addTool<Params extends ToolParameters>(tool: Tool<Params>) {
    this.#tools.push(tool as unknown as Tool);
  }

  /**
   * Adds a resource to the server.
   */
  public addResource(resource: Resource) {
    this.#resources.push(resource);
  }

  /**
   * Adds a prompt to the server.
   */
  public addPrompt<const Args extends PromptArgument[]>(prompt: Prompt<Args>) {
    this.#prompts.push(prompt);
  }

  #sseServer: SSEServer | null = null;

  /**
   * Starts the server.
   */
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
      this.#sseServer = await startSSEServer({
        endpoint: options.sse.endpoint as `/${string}`,
        port: options.sse.port,
        server: this.#server,
        onClose: (transport) => {
          this.emit("disconnect", {
            transport,
          });
        },
        onConnect: (clientTransport) => {
          this.emit("connect", {
            transport: clientTransport,
          });
        },
      });
    } else {
      throw new Error("Invalid transport type");
    }
  }

  /**
   * Stops the server.
   */
  public async stop() {
    if (this.#sseServer) {
      this.#sseServer.close();
    }
  }
}
