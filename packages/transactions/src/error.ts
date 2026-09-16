import type { TransactionFailure, TransactionFailureCode } from "./types.js";

export class TransactionError extends Error {
  readonly failure: TransactionFailure;

  constructor(code: TransactionFailureCode, message: string, cause?: unknown) {
    super(message);
    this.name = "TransactionError";
    this.failure = { code, message, cause };
  }
}

export function transactionMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
