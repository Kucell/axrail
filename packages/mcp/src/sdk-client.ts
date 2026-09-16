import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type {
  McpCallContext,
  McpClient,
  McpToolDescriptor,
} from "./types.js";

export interface McpSdkClientLike {
  listTools(): Promise<{ readonly tools: readonly unknown[] }>;
  callTool(
    params: { readonly name: string; readonly arguments?: Record<string, unknown> },
    options?: { readonly signal?: AbortSignal },
  ): Promise<unknown>;
  close(): Promise<void>;
}

export class McpSdkClientError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "McpSdkClientError";
    this.code = code;
    this.details = details;
  }
}

export class McpSdkClientAdapter implements McpClient {
  readonly serverId: string;

  constructor(
    serverId: string,
    private readonly client: McpSdkClientLike,
  ) {
    if (!serverId) throw new Error("MCP serverId must not be empty");
    this.serverId = serverId;
  }

  async listTools(): Promise<readonly McpToolDescriptor[]> {
    let result: { readonly tools: readonly unknown[] };
    try {
      result = await this.client.listTools();
    } catch (error) {
      throw normalizeSdkError("list_tools_failed", error);
    }
    return result.tools.map(toDescriptor);
  }

  async callTool(
    name: string,
    input: unknown,
    context: McpCallContext = {},
  ): Promise<unknown> {
    const args = normalizeArguments(input);
    let result: unknown;
    try {
      result = await this.client.callTool(
        { name, arguments: args },
        context.signal ? { signal: context.signal } : undefined,
      );
    } catch (error) {
      throw normalizeSdkError("call_tool_failed", error);
    }

    if (isErrorToolResult(result)) {
      throw new McpSdkClientError(
        "remote_tool_error",
        remoteToolErrorMessage(name, result),
        result,
      );
    }

    return result;
  }

  close(): Promise<void> {
    return this.client.close();
  }
}

export interface ConnectMcpHttpOptions {
  readonly serverId: string;
  readonly url: string | URL;
  readonly clientName?: string;
  readonly clientVersion?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
}

export async function connectMcpHttp(
  options: ConnectMcpHttpOptions,
): Promise<McpSdkClientAdapter> {
  const client = new Client({
    name: options.clientName ?? "axrail",
    version: options.clientVersion ?? "0.1.0",
  });
  const transport = new StreamableHTTPClientTransport(new URL(options.url), {
    requestInit: options.headers
      ? { headers: { ...options.headers } }
      : undefined,
  });

  try {
    await client.connect(
      transport,
      options.signal ? { signal: options.signal } : undefined,
    );
  } catch (error) {
    try {
      await client.close();
    } catch {
      // The original connect error is authoritative.
    }
    throw normalizeSdkError("connect_failed", error);
  }

  return new McpSdkClientAdapter(options.serverId, client);
}

export interface ConnectMcpStdioOptions {
  readonly serverId: string;
  readonly command: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd?: string;
  readonly clientName?: string;
  readonly clientVersion?: string;
  readonly signal?: AbortSignal;
}

export async function connectMcpStdio(
  options: ConnectMcpStdioOptions,
): Promise<McpSdkClientAdapter> {
  const client = new Client({
    name: options.clientName ?? "axrail",
    version: options.clientVersion ?? "0.1.0",
  });
  const transport = new StdioClientTransport({
    command: options.command,
    args: options.args ? [...options.args] : undefined,
    env: options.env ? { ...options.env } : undefined,
    cwd: options.cwd,
  });

  try {
    await client.connect(
      transport,
      options.signal ? { signal: options.signal } : undefined,
    );
  } catch (error) {
    try {
      await client.close();
    } catch {
      // The original connect error is authoritative.
    }
    throw normalizeSdkError("connect_failed", error);
  }

  return new McpSdkClientAdapter(options.serverId, client);
}

function toDescriptor(value: unknown): McpToolDescriptor {
  if (!value || typeof value !== "object") {
    throw new McpSdkClientError("invalid_tool_descriptor", "MCP SDK returned a non-object tool descriptor", value);
  }
  const tool = value as Record<string, unknown>;
  if (typeof tool.name !== "string" || !tool.name) {
    throw new McpSdkClientError("invalid_tool_descriptor", "MCP tool descriptor is missing name", value);
  }

  return {
    name: tool.name,
    title: optionalString(tool.title),
    description: optionalString(tool.description),
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    annotations: normalizeAnnotations(tool.annotations),
    meta: isRecord(tool._meta) ? tool._meta : undefined,
  };
}

function normalizeAnnotations(value: unknown): McpToolDescriptor["annotations"] {
  if (!isRecord(value)) return undefined;
  return {
    title: optionalString(value.title),
    readOnlyHint: optionalBoolean(value.readOnlyHint),
    destructiveHint: optionalBoolean(value.destructiveHint),
    idempotentHint: optionalBoolean(value.idempotentHint),
    openWorldHint: optionalBoolean(value.openWorldHint),
  };
}

function normalizeArguments(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (!isRecord(value) || Array.isArray(value)) {
    throw new McpSdkClientError(
      "invalid_tool_arguments",
      "MCP tool arguments must be a JSON object",
      value,
    );
  }
  return value;
}

function isErrorToolResult(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.isError === true;
}

function remoteToolErrorMessage(name: string, result: Record<string, unknown>): string {
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content
    .filter(isRecord)
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => String(item.text))
    .join("\n");
  return text || `MCP tool ${name} returned isError=true`;
}

function normalizeSdkError(code: string, error: unknown): McpSdkClientError {
  if (error instanceof McpSdkClientError) return error;
  return new McpSdkClientError(
    code,
    error instanceof Error ? error.message : String(error),
    error,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
