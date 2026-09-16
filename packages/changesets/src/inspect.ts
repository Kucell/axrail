import type { ChangeRiskLevel, ChangeSet } from "./model.js";

const RISK_ORDER: readonly ChangeRiskLevel[] = ["L0", "L1", "L2", "L3", "L4", "L5"];

export function highestDeclaredRisk(changeSet: ChangeSet): ChangeRiskLevel | undefined {
  let highest: ChangeRiskLevel | undefined;
  for (const operation of changeSet.operations) {
    const level = operation.risk?.level;
    if (!level) continue;
    if (!highest || RISK_ORDER.indexOf(level) > RISK_ORDER.indexOf(highest)) highest = level;
  }
  return highest;
}

export function referencedOperationIds(changeSet: ChangeSet): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const operation of changeSet.operations) {
    for (const dependency of operation.dependsOn ?? []) ids.add(dependency);
  }
  return ids;
}
