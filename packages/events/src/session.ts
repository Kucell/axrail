import { replaySession } from "./replay.js";
import type {
  AxrailEvent,
  EventStore,
  SessionAppendInput,
  SessionCreateInput,
  SessionRecord,
  SessionStatus,
  StoredAxrailEvent,
} from "./types.js";

export interface SessionServiceOptions {
  readonly store: EventStore;
  readonly idFactory?: () => string;
  readonly eventIdFactory?: () => string;
  readonly now?: () => string;
}

export class SessionService {
  private readonly store: EventStore;
  private readonly idFactory: () => string;
  private readonly eventIdFactory: () => string;
  private readonly now: () => string;

  constructor(options: SessionServiceOptions) {
    this.store = options.store;
    this.idFactory = options.idFactory ?? (() => randomId("ses"));
    this.eventIdFactory = options.eventIdFactory ?? (() => randomId("evt"));
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async create(input: SessionCreateInput = {}): Promise<SessionRecord> {
    const id = input.id ?? this.idFactory();
    const existing = await replaySession(this.store, id);
    if (existing) throw new Error(`Session already exists: ${id}`);

    const time = this.now();
    await this.store.append({
      id: this.eventIdFactory(),
      type: "session.created",
      version: "1",
      time,
      sessionId: id,
      actor: input.actor,
      correlationId: input.correlationId,
      data: { metadata: input.metadata },
    });

    return {
      id,
      createdAt: time,
      updatedAt: time,
      status: "active",
      actor: input.actor,
      metadata: input.metadata,
    };
  }

  async append<T = unknown>(
    sessionId: string,
    input: SessionAppendInput<T>,
  ): Promise<StoredAxrailEvent<T>> {
    const session = await this.requireSession(sessionId);
    if (session.status !== "active") {
      throw new Error(`Cannot append to ${session.status} session ${sessionId}`);
    }

    const event: AxrailEvent<T> = {
      id: this.eventIdFactory(),
      type: input.type,
      version: input.version ?? "1",
      time: this.now(),
      sessionId,
      transactionId: input.transactionId,
      toolCallId: input.toolCallId,
      changeSetId: input.changeSetId,
      artifactRefs: input.artifactRefs,
      actor: input.actor,
      source: input.source,
      correlationId: input.correlationId,
      causationId: input.causationId,
      data: input.data,
      metadata: input.metadata,
    };
    return this.store.append(event);
  }

  complete(sessionId: string, data: unknown = {}): Promise<StoredAxrailEvent> {
    return this.finish(sessionId, "completed", data);
  }

  fail(sessionId: string, data: unknown = {}): Promise<StoredAxrailEvent> {
    return this.finish(sessionId, "failed", data);
  }

  cancel(sessionId: string, data: unknown = {}): Promise<StoredAxrailEvent> {
    return this.finish(sessionId, "cancelled", data);
  }

  load(sessionId: string): Promise<SessionRecord | undefined> {
    return replaySession(this.store, sessionId);
  }

  private async finish(
    sessionId: string,
    status: Exclude<SessionStatus, "active">,
    data: unknown,
  ): Promise<StoredAxrailEvent> {
    const session = await this.requireSession(sessionId);
    if (session.status !== "active") {
      throw new Error(`Session ${sessionId} is already ${session.status}`);
    }

    return this.store.append({
      id: this.eventIdFactory(),
      type: `session.${status}`,
      version: "1",
      time: this.now(),
      sessionId,
      data,
    });
  }

  private async requireSession(sessionId: string): Promise<SessionRecord> {
    const session = await replaySession(this.store, sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    return session;
  }
}

function randomId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
