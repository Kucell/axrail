import type {
  AdapterContextFragment,
  AdapterContextProvider,
  AdapterContextRequest,
} from "./types.js";

interface RegisteredContextProvider {
  readonly adapterId: string;
  readonly provider: AdapterContextProvider;
}

export class AdapterContextRegistry {
  private readonly providers = new Map<string, RegisteredContextProvider>();

  register(adapterId: string, provider: AdapterContextProvider): () => void {
    const key = contextProviderKey(adapterId, provider.id);
    if (this.providers.has(key)) {
      throw new Error(`Adapter context provider already registered: ${key}`);
    }
    this.providers.set(key, { adapterId, provider });
    return () => {
      this.providers.delete(key);
    };
  }

  get(adapterId: string, providerId: string): AdapterContextProvider {
    const key = contextProviderKey(adapterId, providerId);
    const record = this.providers.get(key);
    if (!record) throw new Error(`Adapter context provider not found: ${key}`);
    return record.provider;
  }

  list(adapterId?: string): readonly RegisteredContextProvider[] {
    const records = [...this.providers.values()];
    return adapterId
      ? records.filter((record) => record.adapterId === adapterId)
      : records;
  }

  async buildAll(
    request: AdapterContextRequest,
    adapterId?: string,
  ): Promise<readonly AdapterContextFragment[]> {
    const fragments: AdapterContextFragment[] = [];
    for (const record of this.list(adapterId)) {
      fragments.push(await record.provider.build(request));
    }
    return fragments;
  }
}

export function contextProviderKey(adapterId: string, providerId: string): string {
  return `${adapterId}:${providerId}`;
}
