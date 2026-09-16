import type {
  AxrailEvent,
  EventQuery,
  EventRedactor,
  EventStore,
  StoredAxrailEvent,
} from "./types.js";

export interface InMemoryEventStoreOptions {
  readonly redact?: EventRedactor;
}

export class InMemoryEventStore implements EventStore {
  private readonly events: StoredAxrailEvent[] = [];
  private readonly redact?: EventRedactor;
  private nextSequence = 1;

  constructor(options: InMemoryEventStoreOptions = {}) {
    this.redact = options.redact;
  }

  async append<T = unknown>(event: AxrailEvent<T>): Promise<StoredAxrailEvent<T>> {
    const redacted = this.redact ? await this.redact(event) : event;
    if (!redacted) {
      throw new Error(`Event redaction rejected persistence for ${event.type}`);
    }

    const stored = Object.freeze({
      ...redacted,
      sequence: this.nextSequence++,
    }) as StoredAxrailEvent<T>;
    this.events.push(stored);
    return stored;
  }

  async *read(query: EventQuery = {}): AsyncIterable<StoredAxrailEvent> {
    let emitted = 0;
    for (const event of this.events) {
      if (!matchesQuery(event, query)) continue;
      yield event;
      emitted += 1;
      if (query.limit !== undefined && emitted >= query.limit) return;
    }
  }

  async latest(query: EventQuery = {}): Promise<StoredAxrailEvent | undefined> {
    for (let index = this.events.length - 1; index >= 0; index -= 1) {
      const event = this.events[index];
      if (matchesQuery(event, query)) return event;
    }
    return undefined;
  }

  get size(): number {
    return this.events.length;
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
