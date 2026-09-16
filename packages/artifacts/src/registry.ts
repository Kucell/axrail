import type { Artifact, ArtifactRef } from "./types.js";
import type { ArtifactProvider } from "./provider.js";

export class ArtifactProviderRegistry {
  private readonly providers = new Map<string, ArtifactProvider>();

  register(provider: ArtifactProvider): void {
    if (!provider.id) throw new Error("Artifact provider id must not be empty");
    if (this.providers.has(provider.id)) {
      throw new Error(`Artifact provider already registered: ${provider.id}`);
    }
    this.providers.set(provider.id, provider);
  }

  unregister(id: string): boolean {
    return this.providers.delete(id);
  }

  has(id: string): boolean {
    return this.providers.has(id);
  }

  get(id: string): ArtifactProvider {
    const provider = this.providers.get(id);
    if (!provider) throw new Error(`Artifact provider not found: ${id}`);
    return provider;
  }

  list(): readonly ArtifactProvider[] {
    return [...this.providers.values()];
  }

  providerFor(ref: ArtifactRef): ArtifactProvider {
    if (ref.provider) return this.get(ref.provider);
    if (this.providers.size === 1) return this.providers.values().next().value as ArtifactProvider;
    throw new Error(`Artifact provider is required for ${ref.id}`);
  }

  resolve(ref: ArtifactRef): Promise<Artifact> {
    return this.providerFor(ref).get(ref);
  }
}
