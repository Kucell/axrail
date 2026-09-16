import type { AgentMessage } from "./types.js";

export class AgentSession {
  readonly id: string;
  private readonly history: AgentMessage[] = [];

  constructor(id: string = defaultSessionId()) {
    this.id = id;
  }

  append(message: AgentMessage): void {
    this.history.push(freezeMessage(message));
  }

  messages(): readonly AgentMessage[] {
    return this.history.slice();
  }

  get size(): number {
    return this.history.length;
  }
}

function freezeMessage(message: AgentMessage): AgentMessage {
  return Object.freeze({
    ...message,
    toolCalls: message.toolCalls?.map((call) => Object.freeze({ ...call })),
    metadata: message.metadata ? Object.freeze({ ...message.metadata }) : undefined,
  });
}

function defaultSessionId(): string {
  return `session_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
