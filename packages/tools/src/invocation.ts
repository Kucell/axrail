import type {
  ToolCall,
  ToolDefinition,
  ToolExecutionContext,
  ToolInvocationDescription,
  ToolInvocationEnvelope,
} from "./contract.js";

export async function createToolInvocationEnvelope<TInput>(
  tool: ToolDefinition<TInput, unknown>,
  call: ToolCall,
  effectiveInput: TInput,
  context: ToolExecutionContext,
): Promise<ToolInvocationEnvelope<TInput>> {
  const input = snapshotCanonical(effectiveInput) as TInput;
  const metadata = context.metadata
    ? (snapshotCanonical(context.metadata) as Readonly<Record<string, unknown>>)
    : undefined;
  const description = tool.describeInvocation
    ? snapshotDescription(await tool.describeInvocation(input, context))
    : undefined;

  const base = {
    callId: call.id,
    toolName: tool.name,
    toolVersion: tool.version,
    providerId: tool.providerId,
    risk: tool.risk,
    effect: tool.effect,
    input,
    target: description?.target,
    artifactRefs: description?.artifactRefs,
    descriptionMetadata: description?.metadata,
    context: {
      sessionId: context.sessionId,
      transactionId: context.transactionId,
      actorId: context.actorId,
      environment: metadataString(metadata, "environment"),
      metadata,
    },
  } as const;

  const evidenceDigest = await digestCanonical(base);
  return deepFreeze({ ...base, evidenceDigest }) as ToolInvocationEnvelope<TInput>;
}

export async function digestToolInvocationEvidence(
  invocation: Omit<ToolInvocationEnvelope, "evidenceDigest">,
): Promise<string> {
  return digestCanonical(invocation);
}

function snapshotDescription(
  value: ToolInvocationDescription | undefined,
): ToolInvocationDescription | undefined {
  if (!value) return undefined;
  return snapshotCanonical(value) as ToolInvocationDescription;
}

async function digestCanonical(value: unknown): Promise<string> {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) {
    throw new Error("Web Crypto subtle API is required to digest a Tool invocation");
  }
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await cryptoApi.subtle.digest("SHA-256", bytes);
  return `sha256:${toHex(new Uint8Array(digest))}`;
}

function snapshotCanonical(value: unknown): unknown {
  return JSON.parse(canonicalJson(value));
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Tool invocation evidence does not support non-finite numbers");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalize(item));
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item === undefined) continue;
      if (typeof item === "function" || typeof item === "symbol" || typeof item === "bigint") {
        throw new TypeError(`Unsupported value in Tool invocation evidence at ${key}`);
      }
      output[key] = normalize(item);
    }
    return output;
  }
  throw new TypeError(`Unsupported value in Tool invocation evidence: ${typeof value}`);
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function metadataString(
  metadata: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value ? value : undefined;
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
