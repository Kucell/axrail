import {
  generateText,
  jsonSchema,
  tool as aiTool,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from "ai";
import type {
  AgentMessage,
  AgentModelProvider,
  AgentModelRequest,
  AgentModelResponse,
  AgentModelTool,
  AgentToolCall,
} from "@axrail/agent";

export interface AiSdkModelProviderOptions {
  /** Axrail runtime provider identity. */
  readonly id: string;
  /** Vercel AI SDK language model created by any supported provider package. */
  readonly model: LanguageModel;
  /**
   * AI SDK retry count. Defaults to 0 so Axrail does not silently add extra
   * model calls/cost. Applications may opt in explicitly.
   */
  readonly maxRetries?: number;
  /** Optional provider-specific AI SDK call options. */
  readonly providerOptions?: Readonly<Record<string, Record<string, unknown>>>;
  /**
   * Optional generateText implementation for deterministic tests or controlled
   * embeddings. Normal applications should omit this.
   */
  readonly generateText?: typeof generateText;
}

export class AiSdkModelProvider implements AgentModelProvider {
  readonly id: string;

  private readonly model: LanguageModel;
  private readonly maxRetries: number;
  private readonly providerOptions?: Readonly<Record<string, Record<string, unknown>>>;
  private readonly generateTextImpl: typeof generateText;

  constructor(options: AiSdkModelProviderOptions) {
    this.id = requiredText(options.id, "AI SDK model provider id");
    this.model = options.model;
    if (!this.model) {
      throw new Error("AI SDK language model is required");
    }
    this.maxRetries = options.maxRetries ?? 0;
    if (!Number.isInteger(this.maxRetries) || this.maxRetries < 0) {
      throw new Error("AI SDK maxRetries must be a non-negative integer");
    }
    this.providerOptions = options.providerOptions;
    this.generateTextImpl = options.generateText ?? generateText;
  }

  async complete(request: AgentModelRequest): Promise<AgentModelResponse> {
    const prompt = toAiSdkPrompt(request.messages);
    const tools = toAiSdkTools(request.tools);

    const result = await this.generateTextImpl({
      model: this.model,
      system: prompt.system,
      messages: prompt.messages,
      tools: Object.keys(tools).length > 0 ? tools : undefined,
      maxRetries: this.maxRetries,
      abortSignal: request.signal,
      providerOptions: this.providerOptions,
    } as never);

    return fromAiSdkResult(result as unknown as AiSdkGenerateResult);
  }
}

interface AiSdkGenerateResult {
  readonly text?: string;
  readonly toolCalls?: readonly {
    readonly toolCallId: string;
    readonly toolName: string;
    readonly input: unknown;
  }[];
  readonly finishReason?: unknown;
  readonly usage?: unknown;
  readonly providerMetadata?: unknown;
  readonly warnings?: unknown;
  readonly response?: unknown;
}

export function toAiSdkPrompt(
  messages: readonly AgentMessage[],
): {
  readonly system?: string;
  readonly messages: readonly ModelMessage[];
} {
  const system: string[] = [];
  const output: ModelMessage[] = [];

  for (const message of messages) {
    switch (message.role) {
      case "system": {
        if (message.content) system.push(message.content);
        break;
      }
      case "user": {
        output.push({
          role: "user",
          content: message.content ?? "",
        });
        break;
      }
      case "assistant": {
        if ((message.toolCalls?.length ?? 0) === 0) {
          output.push({
            role: "assistant",
            content: message.content ?? "",
          });
          break;
        }

        const content: Array<Record<string, unknown>> = [];
        if (message.content) {
          content.push({
            type: "text",
            text: message.content,
          });
        }
        for (const call of message.toolCalls ?? []) {
          content.push({
            type: "tool-call",
            toolCallId: call.id,
            toolName: call.name,
            input: call.input,
          });
        }
        output.push({
          role: "assistant",
          content: content as never,
        });
        break;
      }
      case "tool": {
        if (!message.toolCallId) {
          throw new Error("Axrail tool message requires toolCallId for AI SDK");
        }
        if (!message.name) {
          throw new Error("Axrail tool message requires name for AI SDK");
        }
        output.push({
          role: "tool",
          content: [{
            type: "tool-result",
            toolCallId: message.toolCallId,
            toolName: message.name,
            output: {
              type: "text",
              value: message.content ?? "",
            },
          }] as never,
        });
        break;
      }
    }
  }

  return {
    system: system.length > 0 ? system.join("\n\n") : undefined,
    messages: Object.freeze(output),
  };
}

export function toAiSdkTools(
  tools: readonly AgentModelTool[],
): ToolSet {
  const result: Record<string, ReturnType<typeof aiTool>> = {};

  for (const modelTool of tools) {
    const name = requiredText(modelTool.name, "Axrail model tool name");
    if (result[name]) {
      throw new Error(`Duplicate Axrail model tool name: ${name}`);
    }

    result[name] = aiTool({
      description: modelTool.description,
      inputSchema: jsonSchema(
        (modelTool.inputSchema ?? defaultObjectSchema()) as never,
      ),
    });
  }

  return result;
}

export function fromAiSdkResult(
  result: AiSdkGenerateResult,
): AgentModelResponse {
  const toolCalls: AgentToolCall[] = (result.toolCalls ?? []).map((call) => ({
    id: requiredText(call.toolCallId, "AI SDK toolCallId"),
    name: requiredText(call.toolName, "AI SDK toolName"),
    input: call.input,
  }));

  return {
    content: result.text || undefined,
    toolCalls: toolCalls.length > 0
      ? Object.freeze(toolCalls)
      : undefined,
    stopReason: toolCalls.length > 0
      ? "tool_calls"
      : finishReason(result.finishReason),
    metadata: {
      usage: result.usage,
      providerMetadata: result.providerMetadata,
      warnings: result.warnings,
      response: result.response,
    },
  };
}

function finishReason(value: unknown): string {
  if (typeof value === "string" && value) return value;
  if (
    value &&
    typeof value === "object" &&
    "unified" in value &&
    typeof (value as { unified?: unknown }).unified === "string"
  ) {
    return (value as { unified: string }).unified;
  }
  return "completed";
}

function defaultObjectSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {},
    additionalProperties: true,
  };
}

function requiredText(value: string, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must not be empty`);
  }
  return value.trim();
}
