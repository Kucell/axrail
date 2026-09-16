import { readFile } from "node:fs/promises";

import {
  digestChangeSet,
  type ChangeSet,
} from "@axrail/changesets";
import {
  JsonlEventStore,
  collectEvents,
  type EventQuery,
} from "@axrail/events";

export interface CliIO {
  writeStdout(text: string): void;
  writeStderr(text: string): void;
}

export interface CliOptions {
  readonly version?: string;
}

export async function runCli(
  args: readonly string[],
  io: CliIO,
  options: CliOptions = {},
): Promise<number> {
  const [command, ...rest] = args;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    io.writeStdout(helpText());
    return 0;
  }

  if (command === "--version" || command === "version") {
    io.writeStdout(`${options.version ?? "0.0.0-dev"}\n`);
    return 0;
  }

  try {
    if (command === "events") {
      return await runEvents(rest, io);
    }
    if (command === "changeset") {
      return await runChangeSet(rest, io);
    }

    io.writeStderr(`Unknown command: ${command}\n\n${helpText()}`);
    return 2;
  } catch (error) {
    io.writeStderr(`${messageOf(error)}\n`);
    return 1;
  }
}

async function runEvents(args: readonly string[], io: CliIO): Promise<number> {
  const [subcommand, path, ...flags] = args;
  if (subcommand !== "inspect" || !path) {
    io.writeStderr(
      "Usage: axrail events inspect <events.jsonl> [--session ID] [--transaction ID] [--correlation ID] [--changeset ID] [--limit N]\n",
    );
    return 2;
  }

  const query = parseEventQuery(flags);
  const store = new JsonlEventStore({ path });
  const events = await collectEvents(store, query);
  io.writeStdout(`${JSON.stringify(events, null, 2)}\n`);
  return 0;
}

async function runChangeSet(args: readonly string[], io: CliIO): Promise<number> {
  const [subcommand, path, ...extra] = args;
  if (subcommand !== "digest" || !path || extra.length > 0) {
    io.writeStderr("Usage: axrail changeset digest <changeset.json>\n");
    return 2;
  }

  const text = await readFile(path, "utf8");
  const parsed = JSON.parse(text) as unknown;
  const changeSet = parseChangeSetDocument(parsed);
  const digest = await digestChangeSet(changeSet);

  io.writeStdout(
    `${JSON.stringify(
      {
        changeSetId: changeSet.id,
        algorithm: "sha256",
        digest,
      },
      null,
      2,
    )}\n`,
  );
  return 0;
}

function parseEventQuery(flags: readonly string[]): EventQuery {
  const query: {
    sessionId?: string;
    transactionId?: string;
    correlationId?: string;
    changeSetId?: string;
    limit?: number;
  } = {};

  for (let index = 0; index < flags.length; index += 2) {
    const flag = flags[index];
    const value = flags[index + 1];
    if (!value) throw new Error(`Missing value for ${flag}`);

    switch (flag) {
      case "--session":
        query.sessionId = value;
        break;
      case "--transaction":
        query.transactionId = value;
        break;
      case "--correlation":
        query.correlationId = value;
        break;
      case "--changeset":
        query.changeSetId = value;
        break;
      case "--limit": {
        const limit = Number(value);
        if (!Number.isInteger(limit) || limit < 1) {
          throw new Error("--limit must be a positive integer");
        }
        query.limit = limit;
        break;
      }
      default:
        throw new Error(`Unknown events inspect option: ${flag}`);
    }
  }

  return query;
}

function parseChangeSetDocument(value: unknown): ChangeSet {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("ChangeSet document must be a JSON object");
  }

  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || !record.id) {
    throw new Error("ChangeSet.id must be a non-empty string");
  }
  if (typeof record.protocolVersion !== "string" || !record.protocolVersion) {
    throw new Error("ChangeSet.protocolVersion must be a non-empty string");
  }
  if (!Array.isArray(record.artifacts)) {
    throw new Error("ChangeSet.artifacts must be an array");
  }
  if (!Array.isArray(record.operations)) {
    throw new Error("ChangeSet.operations must be an array");
  }

  return value as ChangeSet;
}

export function helpText(): string {
  return [
    "Axrail CLI",
    "",
    "Usage:",
    "  axrail --help",
    "  axrail --version",
    "  axrail events inspect <events.jsonl> [filters]",
    "  axrail changeset digest <changeset.json>",
    "",
    "Event filters:",
    "  --session ID",
    "  --transaction ID",
    "  --correlation ID",
    "  --changeset ID",
    "  --limit N",
    "",
    "v0.1 CLI commands are intentionally read-only/diagnostic and do not perform industrial side effects.",
    "",
  ].join("\n");
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
