export interface EventPrincipalRef {
  readonly id: string;
  readonly type: string;
  readonly roles?: readonly string[];
  readonly displayName?: string;
}

export interface AxrailEvent<T = unknown> {
  readonly id: string;
  readonly type: string;
  readonly version: string;
  readonly time: string;
  readonly sessionId?: string;
  readonly transactionId?: string;
  readonly toolCallId?: string;
  readonly changeSetId?: string;
  readonly artifactRefs?: readonly string[];
  readonly actor?: EventPrincipalRef;
  readonly source?: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly data: T;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface StoredAxrailEvent<T = unknown> extends AxrailEvent<T> {
  readonly sequence: number;
}

export interface EventQuery {
  readonly sessionId?: string;
  readonly transactionId?: string;
  readonly toolCallId?: string;
  readonly changeSetId?: string;
  readonly correlationId?: string;
  readonly afterSequence?: number;
  readonly limit?: number;
}

export type EventRedactor = (
  event: AxrailEvent,
) => AxrailEvent | undefined | Promise<AxrailEvent | undefined>;

export interface EventStore {
  append<T = unknown>(event: AxrailEvent<T>): Promise<StoredAxrailEvent<T>>;
  read(query?: EventQuery): AsyncIterable<StoredAxrailEvent>;
  latest(query?: EventQuery): Promise<StoredAxrailEvent | undefined>;
}

export type SessionStatus = "active" | "completed" | "failed" | "cancelled";

export interface SessionRecord {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly status: SessionStatus;
  readonly actor?: EventPrincipalRef;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface SessionCreateInput {
  readonly id?: string;
  readonly actor?: EventPrincipalRef;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly correlationId?: string;
}

export interface SessionAppendInput<T = unknown> {
  readonly type: string;
  readonly version?: string;
  readonly transactionId?: string;
  readonly toolCallId?: string;
  readonly changeSetId?: string;
  readonly artifactRefs?: readonly string[];
  readonly actor?: EventPrincipalRef;
  readonly source?: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly data: T;
  readonly metadata?: Readonly<Record<string, unknown>>;
}
