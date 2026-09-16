import type {
  EventQuery,
  EventStore,
  SessionRecord,
  StoredAxrailEvent,
} from "./types.js";

export async function collectEvents(
  store: EventStore,
  query: EventQuery = {},
): Promise<readonly StoredAxrailEvent[]> {
  const events: StoredAxrailEvent[] = [];
  for await (const event of store.read(query)) events.push(event);
  return events;
}

export async function replaySession(
  store: EventStore,
  sessionId: string,
): Promise<SessionRecord | undefined> {
  let record: SessionRecord | undefined;

  for await (const event of store.read({ sessionId })) {
    if (event.type === "session.created") {
      const data = asRecord(event.data);
      record = {
        id: sessionId,
        createdAt: event.time,
        updatedAt: event.time,
        status: "active",
        actor: event.actor,
        metadata: asMetadata(data.metadata),
      };
      continue;
    }

    if (!record) continue;
    const status = sessionStatusFromEvent(event.type);
    record = {
      ...record,
      updatedAt: event.time,
      status: status ?? record.status,
    };
  }

  return record;
}

function sessionStatusFromEvent(type: string): SessionRecord["status"] | undefined {
  switch (type) {
    case "session.completed":
      return "completed";
    case "session.failed":
      return "failed";
    case "session.cancelled":
      return "cancelled";
    default:
      return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asMetadata(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value && typeof value === "object"
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}
