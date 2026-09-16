import { PluginManager, type AxrailPlugin } from "./plugin.js";
import { AxrailScope, type ScopeKind } from "./scope.js";

export interface AxrailRuntimeOptions {
  readonly id?: string;
}

export class AxrailRuntime {
  readonly scope: AxrailScope;
  readonly plugins: PluginManager;

  constructor(options: AxrailRuntimeOptions = {}) {
    this.scope = new AxrailScope({
      id: options.id ?? "runtime",
      kind: "runtime",
    });
    this.plugins = new PluginManager(this.scope);
  }

  async use(plugin: AxrailPlugin): Promise<this> {
    await this.plugins.use(plugin);
    return this;
  }

  createScope(id: string, kind: Exclude<ScopeKind, "runtime">): AxrailScope {
    return this.scope.child(id, kind);
  }

  async dispose(): Promise<void> {
    await this.plugins.dispose();
    await this.scope.dispose();
  }
}

export function createRuntime(options?: AxrailRuntimeOptions): AxrailRuntime {
  return new AxrailRuntime(options);
}
