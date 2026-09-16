import type { ArtifactRef } from "@axrail/artifacts";

export type ChangeRiskLevel = "L0" | "L1" | "L2" | "L3" | "L4" | "L5";

export interface ActorRef {
  readonly id: string;
  readonly type: string;
  readonly displayName?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface Precondition {
  readonly id?: string;
  readonly kind: string;
  readonly target?: string;
  readonly operator?: string;
  readonly expected?: unknown;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface OperationRisk {
  readonly level: ChangeRiskLevel;
  readonly reasons?: readonly string[];
}

export interface ChangeOperation {
  readonly id?: string;
  readonly op: string;
  readonly target: string;
  readonly path?: string;
  readonly value?: unknown;
  readonly from?: string;
  readonly dependsOn?: readonly string[];
  readonly idempotencyKey?: string;
  readonly risk?: OperationRisk;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ChangeSet {
  readonly id: string;
  readonly protocolVersion: string;
  readonly artifacts: readonly ArtifactRef[];
  readonly operations: readonly ChangeOperation[];
  readonly reason?: string;
  readonly actor?: ActorRef;
  readonly preconditions?: readonly Precondition[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export const GENERIC_CHANGE_OPERATIONS = [
  "create",
  "update",
  "replace",
  "remove",
  "move",
  "copy",
  "invoke",
  "bind",
  "unbind",
] as const;

export type GenericChangeOperation = (typeof GENERIC_CHANGE_OPERATIONS)[number];

export function isGenericChangeOperation(value: string): value is GenericChangeOperation {
  return (GENERIC_CHANGE_OPERATIONS as readonly string[]).includes(value);
}
