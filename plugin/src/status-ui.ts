import { statusText, type SyncPhase } from "./status.js";

export class StatusUI {
  private phase: SyncPhase;

  constructor(
    private readonly statusBarEl: HTMLElement,
    lastSync?: number,
  ) {
    this.phase = lastSync ? { kind: "synced", lastSync } : { kind: "idle" };
    this.render();
  }

  setSyncing(done: number, total: number): void {
    this.phase = { kind: "syncing", done, total };
    this.render();
  }

  setSynced(lastSync: number): void {
    this.phase = { kind: "synced", lastSync };
    this.render();
  }

  setFailed(): void {
    this.phase = { kind: "failed" };
    this.render();
  }

  setOffline(): void {
    this.phase = { kind: "offline" };
    this.render();
  }

  /** Refresh relative-time text without changing phase. */
  refresh(): void {
    this.render();
  }

  private render(): void {
    this.statusBarEl.setText(`⇩ ${statusText(this.phase, Date.now())}`);
  }
}
