# Axrail Correlated Audit Model

Axrail records observable execution events without persisting model hidden reasoning.

## Correlation identifiers

A single engineering request may span:

- an agent session;
- one or more tool calls;
- policy evaluations;
- approval requests;
- ChangeSets;
- transactions;
- artifact mutations.

The following identifiers connect those layers:

```text
sessionId
correlationId
transactionId
toolCallId
changeSetId
artifactRefs[]
```

`correlationId` is the broad workflow/work-order key. Other identifiers address a specific execution boundary.

## Event families

```text
session.*
agent.*
tool.execution.*
policy.evaluation.*
approval.*
transaction.*
```

Tool/transaction observers are instrumentation only in the current v0.1 profile. A future durable-audit profile may require successful event persistence before privileged commit.

## Sensitive data

Events should contain references and summaries, not secrets, full proprietary project payloads, or hidden model reasoning. `EventStore` redaction hooks run before persistence.
