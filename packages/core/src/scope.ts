import { CapabilityRegistry } from "./capability.js";
import { EventBus } from "./events.js";

export type ScopeKind = "runtime" | "workspace" | "session" | "transaction";

export interface ScopeOptions {
  readonly id: string;
  readonly kind: ScopeKind;
  readonly parent?: AxrailScope;
}

export class AxrailScope {
  readonly id: string;
  readonly kind: ScopeKind;
  readonly parent?: AxrailScope;
  readonly capabilities = new CapabilityRegistry();
  readonly events = new EventBus();
  private disposed = false;
  private readonly disposers: Array<() => void | Promise<void>> = [];

  constructor(options: ScopeOptions) {
    this.id = options.id;
    this.kind = options.kind;
    this.parent = options.parent;
  }

  child(id: string, kind: ScopeKind): AxrailScope {
    this.assertActive();
    return new AxrailScope({ id, kind, parent: this });
  }

  addDisposer(disposer: () => void | Promise<void>): void {
    this.assertActive();
    this.disposers.push(disposer);
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const disposer of [...this.disposers].reverse()) {
      await disposer();
    }
    this.disposers.length = 0;
  }

  private assertActive(): void {
    if (this.disposed) throw new Error(`Scope already disposed: ${this.id}`);
  }
}
