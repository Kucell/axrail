# Approval Freshness and Evidence Binding

Axrail transaction approvals can be bound to a canonical ChangeSet digest.

```text
ChangeSet
   ↓ canonical JSON
SHA-256 digest
   ↓
ApprovalRequest.evidenceDigest
   ↓
ApprovalDecision.evidenceDigest
```

For an approved decision, the decision digest must match the current request digest. A missing or stale digest fails closed with `evidence_mismatch`.

The transaction approval bridge also records:

- ChangeSet ID and digest;
- baseline artifact versions;
- validation summary;
- environment;
- adapter IDs;
- transaction mode.

Artifact versions are independently protected by TransactionRuntime optimistic concurrency. A project changed after approval therefore cannot silently commit against the old baseline.

`CallbackApprovalProvider` is an in-process helper and automatically echoes the current request digest. External approval services must return the matching digest themselves.
