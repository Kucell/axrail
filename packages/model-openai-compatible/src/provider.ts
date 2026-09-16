import type {
  AgentMessage,
  AgentModelProvider,
  AgentModelRequest,
  AgentModelResponse,
  AgentModelTool,
  AgentToolCall,
} from "@axrail/agent";

export interface OpenAICompatibleResponsesProviderOptions {
  readonly model: string;
  readonly apiKey?: string | (() => string | Promise<string>);
  readonly baseUrl?: string;
  readonly id?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetch?: typeof globalThis.fetch;
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  readonly extraBody?: Readonly<Record<string, unknown>>;
}

export class ModelProviderError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly details?: unknown;

  constructor(code: string, message: string, options: { status?: number; details?: unknown } = {}) {
    super(message);
    this.name = "ModelProviderError";
    this.code = code;
    this.status = options.status;
    this.details = options.details;
  }
}

export class OpenAICompatibleResponsesProvider implements AgentModelProvider {
  readonly id: string;

  private readonly model: string;
  private readonly apiKey?: OpenAICompatibleResponsesProviderOptions["apiKey"];
  private readonly baseUrl: string;
  private readonly headers: Readonly<Record<string, string>>;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly maxOutputTokens?: number;
  private readonly temperature?: number;
  private readonly extraBody?: Readonly<Record<string, unknown>>;

  constructor(options: OpenAICompatibleResponsesProviderOptions) {
    if (!options.model) throw new Error("Model id must not be empty");
    this.id = options.id ?? `openai-compatible:${options.model}`;
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.baseUrl = trimTrailingSlash(options.baseUrl ?? "https://api.openai.com/v1");
    this.headers = options.headers ?? {};
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (!this.fetchImpl) throw new Error("A fetch implementation is required");
    this.maxOutputTokens = options.maxOutputTokens;
    this.temperature = options.temperature;
    this.extraBody = options.extraBody;
  }

  async complete(request: AgentModelRequest): Promise<AgentModelResponse> {
    const { instructions, input } = toResponsesInput(request.messages);
    const body: Record<string, unknown> = {
      ...this.extraBody,
      model: this.model,
      input,
    };

    if (instructions) body.instructions = instructions;
    if (request.tools.length > 0) body.tools = request.tools.map(toResponsesTool);
    if (this.maxOutputTokens !== undefined) body.max_output_tokens = this.maxOutputTokens;
    if (this.temperature !== undefined) body.temperature = this.temperature;

    const response = await this.fetchImpl(`${this.baseUrl}/responses`, {
      method: "POST",
      headers: await this.requestHeaders(),
      body: JSON.stringify(body),
      signal: request.signal,
    });

    const rawText = await response.text();
    const payload = parseJson(rawText);

    if (!response.ok) {
      throw new ModelProviderError(
        "provider_http_error",
        providerErrorMessage(payload, response.status),
        { status: response.status, details: payload },
      );
    }

    return normalizeResponse(payload);
  }

  private async requestHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...this.headers,
    };
    const apiKey = typeof this.apiKey === "function" ? await this.apiKey() : this.apiKey;
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    return headers;
  }
}

function toResponsesInput(messages: readonly AgentMessage[]): {
  instructions?: string;
  input: unknown[];
} {
  const system: string[] = [];
  const input: unknown[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      if (message.content) system.push(message.content);
      continue;
    }

    if (message.role === "tool") {
      if (!message.toolCallId) {
        throw new ModelProviderError(
          "invalid_history",
          "Tool messages require toolCallId for Responses API normalization",
        );
      }
      input.push({
        type: "function_call_output",
        call_id: message.toolCallId,
        output: message.content ?? "",
      });
      continue;
    }

    if (message.content) {
      input.push({
        type: "message",
        role: message.role,
        content: message.content,
      });
    }

    if (message.role === "assistant") {
      for (const call of message.toolCalls ?? []) {
        input.push({
          type: "function_call",
          call_id: call.id,
          name: call.name,
          arguments: JSON.stringify(call.input ?? {}),
        });
      }
    }
  }

  return {
    instructions: system.length > 0 ? system.join("\n\n") : undefined,
    input,
  };
}

function toResponsesTool(tool: AgentModelTool): Record<string, unknown> {
  return {
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema ?? {
      type: "object",
      properties: {},
      additionalProperties: true,
    },
  };
}

function normalizeResponse(payload: unknown): AgentModelResponse {
  const root = asRecord(payload, "response");
  const output = Array.isArray(root.output) ? root.output : [];
  const text: string[] = [];
  const toolCalls: AgentToolCall[] = [];

  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;

    if (record.type === "message") {
      for (const content of Array.isArray(record.content) ? record.content : []) {
        if (!content || typeof content !== "object") continue;
        const part = content as Record<string, unknown>;
        if ((part.type === "output_text" || part.type === "text") && typeof part.text === "string") {
          text.push(part.text);
        }
      }
      continue;
    }

    if (record.type === "function_call") {
      const name = stringField(record, "name");
      const id = optionalString(record.call_id) ?? optionalString(record.id);
      const args = optionalString(record.arguments) ?? "{}";
      if (!name || !id) {
        throw new ModelProviderError(
          "invalid_tool_call",
          "Responses API function_call is missing call_id/id or name",
          { details: record },
        );
      }
      toolCalls.push({
        id,
        name,
        input: parseToolArguments(args, name),
      });
    }
  }

  return {
    content: text.length > 0 ? text.join("\n") : undefined,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    stopReason: toolCalls.length > 0 ? "tool_calls" : optionalString(root.status) ?? "completed",
    metadata: {
      responseId: optionalString(root.id),
      model: optionalString(root.model),
      usage: root.usage,
    },
  };
}

function parseToolArguments(value: string, toolName: string): unknown {
  try {
    return value ? JSON.parse(value) : {};
  } catch (error) {
    throw new ModelProviderError(
      "invalid_tool_arguments",
      `Model returned invalid JSON arguments for tool ${toolName}: ${error instanceof Error ? error.message : String(error)}`,
      { details: value },
    );
  }
}

function parseJson(value: string): unknown {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new ModelProviderError(
      "invalid_provider_response",
      `Provider returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { details: value },
    );
  }
}

function providerErrorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === "object") {
    const error = (payload as Record<string, unknown>).error;
    if (error && typeof error === "object") {
      const message = (error as Record<string, unknown>).message;
      if (typeof message === "string") return message;
    }
  }
  return `Model provider returned HTTP ${status}`;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    throw new ModelProviderError("invalid_provider_response", `Expected ${label} object`);
  }
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || !value) {
    throw new ModelProviderError("invalid_provider_response", `Expected non-empty string field ${field}`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
