# @axrail/events

Append-only observable events and session replay for Axrail.

The package implements the RFC-0008 boundary without storing model hidden reasoning. It provides:

- versioned event envelopes;
- in-memory reference EventStore;
- sequence-preserving replay;
- session lifecycle events;
- correlation/causation fields;
- redaction before persistence;
- query by session, transaction, tool call, ChangeSet, or correlation ID;
- append-only JSONL storage for embedded/local development scenarios.

## Storage profiles

`InMemoryEventStore` and `JsonlEventStore` are reference/embedded providers. In particular, `JsonlEventStore` is intentionally simple and should not be interpreted as a multi-process, fsync-guaranteed, rotation/retention-managed, replicated, or compliance-certified audit database.

Production deployments that depend on authoritative audit evidence should provide an `EventStore` implementation with durability, concurrency, retention, backup, access-control, and operational guarantees appropriate to the target system while preserving the same Axrail contract.

Use Harness strict audit profiles when execution must fail closed before an externally visible effect or commit if the required audit checkpoint cannot be persisted.
