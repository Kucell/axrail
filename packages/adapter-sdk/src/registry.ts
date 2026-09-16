import type {
  AdapterLifecycleContext,
  AdapterLifecycleState,
  AdapterRecord,
  AxrailAdapter,
  CapabilityManifest,
} from "./types.js";

interface MutableAdapterRecord {
  adapter: AxrailAdapter;
  state: AdapterLifecycleState;
  manifest?: CapabilityManifest;
  error?: Error;
}

export class AdapterRegistry {
  private readonly records = new Map<string, MutableAdapterRecord>();

  register(adapter: AxrailAdapter): void {
    if (!adapter.id) throw new Error("Adapter id must not be empty");
    if (!adapter.version) throw new Error(`Adapter ${adapter.id} version must not be empty`);
    if (this.records.has(adapter.id)) throw new Error(`Adapter already registered: ${adapter.id}`);
    this.records.set(adapter.id, { adapter, state: "registered" });
  }

  unregister(id: string): boolean {
    const record = this.records.get(id);
    if (!record) return false;
    if (record.state === "active" || record.state === "initializing" || record.state === "stopping") {
      throw new Error(`Cannot unregister adapter ${id} while state is ${record.state}`);
    }
    return this.records.delete(id);
  }

  has(id: string): boolean {
    return this.records.has(id);
  }

  get(id: string): AdapterRecord {
    const record = this.records.get(id);
    if (!record) throw new Error(`Adapter not found: ${id}`);
    return snapshot(record);
  }

  list(): readonly AdapterRecord[] {
    return [...this.records.values()].map(snapshot);
  }

  async initialize(id: string, context: AdapterLifecycleContext = {}): Promise<AdapterRecord> {
    const record = this.mutable(id);
    if (record.state !== "registered" && record.state !== "stopped") {
      throw new Error(`Adapter ${id} cannot initialize from state ${record.state}`);
    }

    record.state = "initializing";
    record.error = undefined;
    try {
      await record.adapter.initialize?.(context);
      const manifest = await record.adapter.capabilities();
      validateManifest(record.adapter, manifest);
      record.manifest = manifest;
      record.state = "ready";
    } catch (error) {
      record.error = asError(error);
      record.state = "failed";
      throw record.error;
    }
    return snapshot(record);
  }

  async start(id: string, context: AdapterLifecycleContext = {}): Promise<AdapterRecord> {
    const record = this.mutable(id);
    if (record.state !== "ready") throw new Error(`Adapter ${id} cannot start from state ${record.state}`);
    try {
      await record.adapter.start?.(context);
      record.state = "active";
    } catch (error) {
      record.error = asError(error);
      record.state = "failed";
      throw record.error;
    }
    return snapshot(record);
  }

  async stop(id: string, context: AdapterLifecycleContext = {}): Promise<AdapterRecord> {
    const record = this.mutable(id);
    if (record.state === "stopped") return snapshot(record);
    if (record.state !== "active" && record.state !== "ready" && record.state !== "failed") {
      throw new Error(`Adapter ${id} cannot stop from state ${record.state}`);
    }

    record.state = "stopping";
    try {
      await record.adapter.stop?.(context);
      record.state = "stopped";
      record.error = undefined;
    } catch (error) {
      record.error = asError(error);
      record.state = "failed";
      throw record.error;
    }
    return snapshot(record);
  }

  private mutable(id: string): MutableAdapterRecord {
    const record = this.records.get(id);
    if (!record) throw new Error(`Adapter not found: ${id}`);
    return record;
  }
}

function validateManifest(adapter: AxrailAdapter, manifest: CapabilityManifest): void {
  if (manifest.adapterId !== adapter.id) {
    throw new Error(`Capability manifest adapterId mismatch: expected ${adapter.id}, got ${manifest.adapterId}`);
  }
  if (manifest.adapterVersion !== adapter.version) {
    throw new Error(`Capability manifest version mismatch for ${adapter.id}`);
  }
}

function snapshot(record: MutableAdapterRecord): AdapterRecord {
  return {
    adapter: record.adapter,
    state: record.state,
    manifest: record.manifest,
    error: record.error,
  };
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
