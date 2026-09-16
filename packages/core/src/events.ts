export interface AxrailEvent<T = unknown> {
  readonly id: string;
  readonly type: string;
  readonly timestamp: string;
  readonly payload: T;
  readonly sessionId?: string;
  readonly transactionId?: string;
  readonly correlationId?: string;
  readonly causationId?: string;
}

export type EventListener<T = unknown> = (event: AxrailEvent<T>) => void | Promise<void>;

export class EventBus {
  private readonly listeners = new Map<string, Set<EventListener<unknown>>>();
  private readonly wildcard = new Set<EventListener<unknown>>();

  on<T>(type: string, listener: EventListener<T>): () => void {
    const set = this.listeners.get(type) ?? new Set<EventListener<unknown>>();
    set.add(listener as EventListener<unknown>);
    this.listeners.set(type, set);
    return () => set.delete(listener as EventListener<unknown>);
  }

  onAny(listener: EventListener<unknown>): () => void {
    this.wildcard.add(listener);
    return () => this.wildcard.delete(listener);
  }

  async emit<T>(event: AxrailEvent<T>): Promise<void> {
    const listeners = [
      ...(this.listeners.get(event.type) ?? []),
      ...this.wildcard,
    ];
    for (const listener of listeners) {
      await listener(event as AxrailEvent<unknown>);
    }
  }
}

export function createEvent<T>(
  type: string,
  payload: T,
  context: Omit<AxrailEvent<T>, "id" | "type" | "timestamp" | "payload"> = {},
): AxrailEvent<T> {
  return {
    id: crypto.randomUUID(),
    type,
    timestamp: new Date().toISOString(),
    payload,
    ...context,
  };
}
