import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  AxrailEvent,
  EventQuery,
  EventRedactor,
  EventStore,
  StoredAxrailEvent,
} from "./types.js";

export interface JsonlEventStoreOptions {
  readonly path: string;
  readonly redact?: EventRedactor;
}

export class EventStoreCorruptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventStoreCorruptionError";
  }
}

/**
 * A small durable EventStore reference implementation.
 *
 * Each StoredAxrailEvent is persisted as one JSON object per line. Appends are
 * serialized within the process so sequence assignment and file order stay in
 * lockstep. The format is intentionally simple and portable; deployments that
 * need database-level durability or multi-process writers can implement the
 * same EventStore contract with SQLite/Postgres/etc.
 */
export class JsonlEventStore implements EventStore {
  readonly path: string;

  private readonly redact?: EventRedactor;
  private initialized?: Promise<void>;
  private appendTail: Promise<void> = Promise.resolve();
  private nextSequence = 1;

  constructor(options: JsonlEventStoreOptions) {
    if (!options.path) throw new Error("JsonlEventStore path must not be empty");
    this.path = options.path;
    this.redact = options.redact;
  }

  async append<T = unknown>(event: AxrailEvent<T>): Promise<StoredAxrailEvent<T>> {
    let resolveStored!: (event: StoredAxrailEvent<T>) => void;
    let rejectStored!: (error: unknown) => void;
    const result = new Promise<StoredAxrailEvent<T>>((resolve, reject) => {
      resolveStored = resolve;
      rejectStored = reject;
    });

    const operation = this.appendTail.then(async () => {
      try {
        await this.ensureInitialized();
        const redacted = this.redact ? await this.redact(event) : event;
        if (!redacted) {
          throw new Error(`Event redaction rejected persistence for ${event.type}`);
        }

        const stored = Object.freeze({
          ...redacted,
          sequence: this.nextSequence,
        }) as StoredAxrailEvent<T>;

        const line = serializeEvent(stored);
        await mkdir(dirname(this.path), { recursive: true });
        await appendFile(this.path, `${line}\n`, "utf8");
        this.nextSequence += 1;
        resolveStored(stored);
      } catch (error) {
        rejectStored(error);
      }
    });

    // A failed append must not permanently poison subsequent appends. The
    // caller receives the failure through `result`, while the internal tail is
    // reset to a fulfilled promise after cleanup.
    this.appendTail = operation.then(
      () => undefined,
      () => undefined,
    );

    return result;
  }

  async *read(query: EventQuery = {}): AsyncIterable<StoredAxrailEvent> {
    await this.appendTail;
    await this.ensureInitialized();

    let emitted = 0;
    for (const event of await this.readAll()) {
      if (!matchesQuery(event, query)) continue;
      yield event;
      emitted += 1;
      if (query.limit !== undefined && emitted >= query.limit) return;
    }
  }

  async latest(query: EventQuery = {}): Promise<StoredAxrailEvent | undefined> {
    await this.appendTail;
    await this.ensureInitialized();

    const events = await this.readAll();
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (matchesQuery(event, query)) return event;
    }
    return undefined;
  }

  private ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      this.initialized = this.initialize().catch((error) => {
        this.initialized = undefined;
        throw error;
      });
    }
    return this.initialized;
  }

  private async initialize(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const events = await this.readAll();
    let previous = 0;

    for (const event of events) {
      if (event.sequence <= previous) {
        throw new EventStoreCorruptionError(
          `Event sequence is not strictly increasing at ${event.sequence}`,
        );
      }
      previous = event.sequence;
    }

    this.nextSequence = previous + 1;
  }

  private async readAll(): Promise<StoredAxrailEvent[]> {
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch (error) {
      if (isErrorWithCode(error) && error.code === "ENOENT") return [];
      throw error;
    }

    if (!text) return [];

    const events: StoredAxrailEvent[] = [];
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim();
      if (!line) continue;
      events.push(parseStoredEvent(line, index + 1));
    }
    return events;
  }
}

function parseStoredEvent(line: string, lineNumber: number): StoredAxrailEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw new EventStoreCorruptionError(
      `Invalid JSONL event at line ${lineNumber}: ${messageOf(error)}`,
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new EventStoreCorruptionError(`Invalid event object at line ${lineNumber}`);
  }

  const record = parsed as Partial<StoredAxrailEvent>;
  if (!Number.isInteger(record.sequence) || (record.sequence ?? 0) < 1) {
    throw new EventStoreCorruptionError(`Invalid event sequence at line ${lineNumber}`);
  }
  for (const field of ["id", "type", "version", "time"] as const) {
    if (typeof record[field] !== "string" || !record[field]) {
      throw new EventStoreCorruptionError(
        `Invalid event ${field} at line ${lineNumber}`,
      );
    }
  }

  return Object.freeze(record as StoredAxrailEvent);
}

function serializeEvent(event: StoredAxrailEvent): string {
  try {
    return JSON.stringify(event);
  } catch (error) {
    throw new Error(`Event is not JSON serializable: ${messageOf(error)}`);
  }
}

function matchesQuery(event: StoredAxrailEvent, query: EventQuery): boolean {
  if (query.afterSequence !== undefined && event.sequence <= query.afterSequence) return false;
  if (query.sessionId !== undefined && event.sessionId !== query.sessionId) return false;
  if (query.transactionId !== undefined && event.transactionId !== query.transactionId) return false;
  if (query.toolCallId !== undefined && event.toolCallId !== query.toolCallId) return false;
  if (query.changeSetId !== undefined && event.changeSetId !== query.changeSetId) return false;
  if (query.correlationId !== undefined && event.correlationId !== query.correlationId) return false;
  return true;
}

function isErrorWithCode(error: unknown): error is Error & { readonly code?: string } {
  return error instanceof Error && "code" in error;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
