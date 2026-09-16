import type { ChangeSet } from "./model.js";

export function canonicalizeChangeSet(changeSet: ChangeSet): string {
  return canonicalJson(changeSet);
}

export async function digestChangeSet(changeSet: ChangeSet): Promise<string> {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) {
    throw new Error("Web Crypto subtle API is required to digest a ChangeSet");
  }

  const bytes = new TextEncoder().encode(canonicalizeChangeSet(changeSet));
  const digest = await cryptoApi.subtle.digest("SHA-256", bytes);
  return `sha256:${toHex(new Uint8Array(digest))}`;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON does not support non-finite numbers");
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) =>
      item === undefined || typeof item === "function" || typeof item === "symbol"
        ? null
        : normalize(item),
    );
  }

  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (
        item === undefined ||
        typeof item === "function" ||
        typeof item === "symbol"
      ) {
        continue;
      }
      output[key] = normalize(item);
    }
    return output;
  }

  throw new TypeError(`Unsupported value in canonical JSON: ${typeof value}`);
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
