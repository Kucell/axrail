# Axrail v0.1 — Runtime Integration Roadmap

The first foundation milestone (governed tools, transactions, adapters, events, model providers, and MCP SDK transport) is complete.

The next phase turns the packages into a cohesive embeddable harness while preserving package independence.

## Stage 2

1. **HarnessRuntime composition root**
   - compose AdapterHost, ToolRuntime, EventStore, SessionService, Policy, Validation and Approval
   - mount adapters through one runtime boundary
   - create session-backed agents through one API

2. **Unified event instrumentation**
   - normalize agent, tool, policy, approval and transaction lifecycle events into `@axrail/events`
   - preserve session / transaction / tool-call / correlation IDs
   - fail closed where durable audit is required

3. **Durable EventStore provider**
   - provider-neutral persistence reference (initially JSONL or SQLite)
   - restart/replay behavior
   - explicit retention/redaction behavior

4. **ChangeSet digest and approval freshness**
   - stable canonical digest
   - bind approvals to ChangeSet + artifact versions + target context
   - invalidate approval after material execution changes

5. **Vendor-neutral HMI Adapter Kit**
   - reusable conventions for HMI artifact/tool/capability naming
   - mock/reference adapter only
   - no proprietary company HMI code or schemas
