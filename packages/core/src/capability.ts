export type CapabilityMultiplicity = "single" | "multiple" | "ordered";

export interface Capability<T = unknown> {
  readonly id: string;
  readonly version: string;
  readonly multiplicity?: CapabilityMultiplicity;
}

export interface CapabilityProvider<T = unknown> {
  readonly capability: Capability<T>;
  readonly value: T;
  readonly providerId: string;
  readonly priority?: number;
}

export class CapabilityRegistry {
  private readonly providers = new Map<string, CapabilityProvider<unknown>[]>();

  register<T>(provider: CapabilityProvider<T>): () => void {
    const list = this.providers.get(provider.capability.id) ?? [];
    const next = [...list, provider as CapabilityProvider<unknown>].sort(
      (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
    );
    this.providers.set(provider.capability.id, next);
    return () => this.unregister(provider);
  }

  unregister<T>(provider: CapabilityProvider<T>): void {
    const list = this.providers.get(provider.capability.id);
    if (!list) return;
    const next = list.filter((item) => item !== provider);
    if (next.length === 0) this.providers.delete(provider.capability.id);
    else this.providers.set(provider.capability.id, next);
  }

  has(capability: Capability<unknown>): boolean {
    return (this.providers.get(capability.id)?.length ?? 0) > 0;
  }

  resolve<T>(capability: Capability<T>): T {
    const list = this.providers.get(capability.id) ?? [];
    if (list.length === 0) throw new Error(`Capability not found: ${capability.id}`);
    if ((capability.multiplicity ?? "single") !== "single") {
      throw new Error(`Capability ${capability.id} requires resolveAll()`);
    }
    if (list.length > 1) {
      throw new Error(`Capability ${capability.id} has multiple providers`);
    }
    return list[0].value as T;
  }

  resolveAll<T>(capability: Capability<T>): readonly T[] {
    return (this.providers.get(capability.id) ?? []).map((item) => item.value as T);
  }

  snapshot(): ReadonlyMap<string, readonly CapabilityProvider<unknown>[]> {
    return new Map([...this.providers.entries()].map(([key, value]) => [key, [...value]]));
  }
}
