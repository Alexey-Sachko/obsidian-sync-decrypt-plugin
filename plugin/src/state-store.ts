import type { PersistedState, StateStore } from "./types.js";

export type PersistFn = (state: PersistedState) => Promise<void>;

export class PluginStateStore implements StateStore {
  constructor(
    private state: PersistedState,
    private readonly persist: PersistFn,
  ) {}

  get(): PersistedState {
    return this.state;
  }

  set(next: PersistedState): void {
    this.state = next;
  }

  async save(): Promise<void> {
    await this.persist(this.state);
  }
}
