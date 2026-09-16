import type { AxrailScope } from "./scope.js";

export interface PluginContext {
  readonly scope: AxrailScope;
}

export interface AxrailPlugin {
  readonly id: string;
  readonly version: string;
  readonly requires?: readonly string[];
  setup(context: PluginContext): void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>;
}

export class PluginManager {
  private readonly plugins = new Map<string, AxrailPlugin>();
  private readonly disposers = new Map<string, () => void | Promise<void>>();

  constructor(private readonly scope: AxrailScope) {}

  has(id: string): boolean {
    return this.plugins.has(id);
  }

  list(): readonly AxrailPlugin[] {
    return [...this.plugins.values()];
  }

  async use(plugin: AxrailPlugin): Promise<void> {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`Plugin already registered: ${plugin.id}`);
    }
    for (const dependency of plugin.requires ?? []) {
      if (!this.plugins.has(dependency)) {
        throw new Error(`Plugin ${plugin.id} requires missing plugin ${dependency}`);
      }
    }
    const disposer = await plugin.setup({ scope: this.scope });
    this.plugins.set(plugin.id, plugin);
    if (disposer) this.disposers.set(plugin.id, disposer);
  }

  async remove(id: string): Promise<void> {
    const dependents = [...this.plugins.values()].filter((plugin) => plugin.requires?.includes(id));
    if (dependents.length > 0) {
      throw new Error(`Cannot remove plugin ${id}; required by ${dependents.map((p) => p.id).join(", ")}`);
    }
    const disposer = this.disposers.get(id);
    if (disposer) await disposer();
    this.disposers.delete(id);
    this.plugins.delete(id);
  }

  async dispose(): Promise<void> {
    const ids = [...this.plugins.keys()].reverse();
    for (const id of ids) {
      if (!this.plugins.has(id)) continue;
      await this.remove(id);
    }
  }
}
