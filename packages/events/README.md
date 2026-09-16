# @axrail/events

Append-only observable events and session replay for Axrail.

The package implements the RFC-0008 boundary without storing model hidden reasoning. It provides:

- versioned event envelopes;
- in-memory reference EventStore;
- sequence-preserving replay;
- session lifecycle events;
- correlation/causation fields;
- redaction before persistence;
- query by session, transaction, tool call, ChangeSet, or correlation ID.

Production deployments can replace `InMemoryEventStore` with a durable provider while preserving the same `EventStore` contract.
