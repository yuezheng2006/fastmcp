import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ClientCapabilities,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  Root,
  RootsListChangedNotificationSchema,
  ServerCapabilities,
  SetLevelRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod";
import { setTimeout as delay } from "timers/promises";
import { readFile } from "fs/promises";
import { fileTypeFromBuffer } from "file-type";
import { StrictEventEmitter } from "strict-event-emitter-types";
import { EventEmitter } from "events";
import { startSSEServer } from "mcp-proxy";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

export type SSEServer = {
  close: () => Promise<void>;
};

type FastMCPEvents = {
  connect: (event: { session: FastMCPSession }) => void;
  disconnect: (event: { session: FastMCPSession }) => void;
};

type FastMCPSessionEvents = {
  rootsChanged: (event: { roots: Root[] }) => void;
  error: (event: { error: Error }) => void;
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

const FastMCPSessionEventEmitterBase: {
  new (): StrictEventEmitter<EventEmitter, FastMCPSessionEvents>;
} = EventEmitter;

class FastMCPSessionEventEmitter extends FastMCPSessionEventEmitterBase {}

export class FastMCPSession extends FastMCPSessionEventEmitter {
  #capabilities: ServerCapabilities = {};
  #loggingLevel: LoggingLevel = "info";
  #server: Server;
  #clientCapabilities?: ClientCapabilities;
  #roots: Root[] = [];

  constructor({
    name,
    version,
    tools,
    resources,
    prompts,
  }: {
    name: string;
    version: string;
    tools: Tool[];
    resources: Resource[];
    prompts: Prompt[];
  }) {
    super();

    if (tools.length) {
      this.#capabilities.tools = {};
    }

    if (resources.length) {
      this.#capabilities.resources = {};
    }

    if (prompts.length) {
      this.#capabilities.prompts = {};
    }

    this.#capabilities.logging = {};

    this.#server = new Server(
      { name: name, version: version },
      { capabilities: this.#capabilities },
    );

    this.setupErrorHandling();
    this.setupLoggingHandlers();
    this.setupRootsHandlers();

    if (tools.length) {
      this.setupToolHandlers(tools);
    }

    if (resources.length) {
      this.setupResourceHandlers(resources);
    }

    if (prompts.length) {
      this.setupPromptHandlers(prompts);
    }
  }

  public get clientCapabilities(): ClientCapabilities | null {
    return this.#clientCapabilities ?? null;
  }

  public get server(): Server {
    return this.#server;
  }

  #pingInterval: ReturnType<typeof setInterval> | null = null;

  public async connect(transport: Transport) {
    if (this.#server.transport) {
      throw new UnexpectedStateError("Server is already connected");
    }

    await this.#server.connect(transport);

    let attempt = 0;

    while (attempt++ < 10) {
      const capabilities = await this.#server.getClientCapabilities();

      if (capabilities) {
        this.#clientCapabilities = capabilities;

        break;
      }

      await delay(100);
    }

    if (!this.#clientCapabilities) {
      throw new UnexpectedStateError("Server did not connect");
    }

    if (this.#clientCapabilities?.roots) {
      const roots = await this.#server.listRoots();

      this.#roots = roots.roots;
    }

    this.#pingInterval = setInterval(async () => {
      try {
        await this.#server.ping();
      } catch (error) {
        this.emit("error", {
          error: error as Error,
        });
      }
    }, 1000);
  }

  public get roots(): Root[] {
    return this.#roots;
  }

  public async close() {
    if (this.#pingInterval) {
      clearInterval(this.#pingInterval);
    }

    await this.#server.close();
  }

  private setupErrorHandling() {
    this.#server.onerror = (error) => {
      console.error("[MCP Error]", error);
    };
  }

  public get loggingLevel(): LoggingLevel {
    return this.#loggingLevel;
  }

  private setupRootsHandlers() {
    this.#server.setNotificationHandler(
      RootsListChangedNotificationSchema,
      () => {
        this.#server.listRoots().then((roots) => {
          this.#roots = roots.roots;

          this.emit("rootsChanged", {
            roots: roots.roots,
          });
        });
      },
    );
  }

  private setupLoggingHandlers() {
    this.#server.setRequestHandler(SetLevelRequestSchema, (request) => {
      this.#loggingLevel = request.params.level;

      return {};
    });
  }

  private setupToolHandlers(tools: Tool[]) {
    this.#server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: tools.map((tool) => {
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

    this.#server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const tool = tools.find((tool) => tool.name === request.params.name);

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
          await this.#server.notification({
            method: "notifications/progress",
            params: {
              ...progress,
              progressToken,
            },
          });
        };

        const log = {
          debug: (message: string, context?: SerializableValue) => {
            this.#server.sendLoggingMessage({
              level: "debug",
              data: {
                message,
                context,
              },
            });
          },
          error: (message: string, context?: SerializableValue) => {
            this.#server.sendLoggingMessage({
              level: "error",
              data: {
                message,
                context,
              },
            });
          },
          info: (message: string, context?: SerializableValue) => {
            this.#server.sendLoggingMessage({
              level: "info",
              data: {
                message,
                context,
              },
            });
          },
          warn: (message: string, context?: SerializableValue) => {
            this.#server.sendLoggingMessage({
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

  private setupResourceHandlers(resources: Resource[]) {
    this.#server.setRequestHandler(ListResourcesRequestSchema, async () => {
      return {
        resources: resources.map((resource) => {
          return {
            uri: resource.uri,
            name: resource.name,
            mimeType: resource.mimeType,
          };
        }),
      };
    });

    this.#server.setRequestHandler(
      ReadResourceRequestSchema,
      async (request) => {
        const resource = resources.find(
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
      },
    );
  }

  private setupPromptHandlers(prompts: Prompt[]) {
    this.#server.setRequestHandler(ListPromptsRequestSchema, async () => {
      return {
        prompts: prompts.map((prompt) => {
          return {
            name: prompt.name,
            description: prompt.description,
            arguments: prompt.arguments,
          };
        }),
      };
    });

    this.#server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const prompt = prompts.find(
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
}

const FastMCPEventEmitterBase: {
  new (): StrictEventEmitter<EventEmitter, FastMCPEvents>;
} = EventEmitter;

class FastMCPEventEmitter extends FastMCPEventEmitterBase {}

export class FastMCP extends FastMCPEventEmitter {
  #options: ServerOptions;
  #prompts: Prompt[] = [];
  #resources: Resource[] = [];
  #sessions: FastMCPSession[] = [];
  #sseServer: SSEServer | null = null;
  #tools: Tool[] = [];

  constructor(public options: ServerOptions) {
    super();

    this.#options = options;
  }

  public get sessions(): FastMCPSession[] {
    return this.#sessions;
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
    if (options.transportType === "stdio") {
      const transport = new StdioServerTransport();

      const session = new FastMCPSession({
        name: this.#options.name,
        version: this.#options.version,
        tools: this.#tools,
        resources: this.#resources,
        prompts: this.#prompts,
      });

      await session.connect(transport);

      this.#sessions.push(session);

      this.emit("connect", {
        session,
      });

      console.error(`server is running on stdio`);
    } else if (options.transportType === "sse") {
      this.#sseServer = await startSSEServer<FastMCPSession>({
        endpoint: options.sse.endpoint as `/${string}`,
        port: options.sse.port,
        createServer: async () => {
          return new FastMCPSession({
            name: this.#options.name,
            version: this.#options.version,
            tools: this.#tools,
            resources: this.#resources,
            prompts: this.#prompts,
          });
        },
        onClose: (session) => {
          this.emit("disconnect", {
            session,
          });
        },
        onConnect: async (session) => {
          this.#sessions.push(session);

          this.emit("connect", {
            session,
          });
        },
      });

      console.error(
        `server is running on SSE at http://localhost:${options.sse.port}${options.sse.endpoint}`,
      );
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
