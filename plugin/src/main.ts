import { Notice, Plugin, requestUrl } from "obsidian";
import type { PersistedState, PluginSettings, RequestFn } from "./types.js";
import { DEFAULT_SETTINGS, SyncSettingsTab } from "./settings.js";
import { ObsidianWebDavClient } from "./webdav.js";
import { ObsidianVaultWriter } from "./vault-writer.js";
import { PluginStateStore } from "./state-store.js";
import { SyncEngine } from "./engine.js";
import { Scheduler } from "./scheduler.js";
import { StatusUI } from "./status-ui.js";

interface StoredData {
  settings: PluginSettings;
  state: PersistedState;
}

export default class WebDavDecryptSyncPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  private state: PersistedState = { fileState: {} };
  private scheduler!: Scheduler;
  private status!: StatusUI;
  private syncing = false;

  async onload(): Promise<void> {
    await this.loadStored();

    this.status = new StatusUI(this.addStatusBarItem(), this.state.lastSync);
    this.scheduler = new Scheduler(
      {
        setInterval: (cb, ms) => window.setInterval(cb, ms),
        clearInterval: (id) => window.clearInterval(id),
      },
      () => void this.syncNow(),
    );

    this.addRibbonIcon("refresh-cw", "Sync now (WebDAV Decrypt)", () => void this.syncNow());

    this.addCommand({ id: "sync-now", name: "Sync now", callback: () => void this.syncNow() });
    this.addCommand({
      id: "reset-sync-state",
      name: "Reset local sync state",
      callback: () => void this.resetState(),
    });

    this.addSettingTab(new SyncSettingsTab(this));

    this.app.workspace.onLayoutReady(() => {
      this.applySchedule();
      if (this.settings.syncOnOpen) void this.syncNow();
    });
  }

  onunload(): void {
    this.scheduler?.stop();
  }

  makeRequest(): RequestFn {
    return async (arg) => {
      const res = await requestUrl({
        url: arg.url,
        method: arg.method,
        headers: arg.headers,
        throw: false,
      });
      return { status: res.status, arrayBuffer: res.arrayBuffer };
    };
  }

  applySchedule(): void {
    this.scheduler.start(this.settings.syncInterval);
  }

  async syncNow(): Promise<void> {
    if (this.syncing) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      this.status.setOffline();
      return;
    }
    this.syncing = true;
    try {
      const webdav = new ObsidianWebDavClient({
        baseUrl: this.settings.webdavUrl,
        remoteBase: this.settings.remoteBase,
        user: this.settings.webdavUser,
        pass: this.settings.webdavPass,
        request: this.makeRequest(),
      });
      const vault = new ObsidianVaultWriter(this.app.vault.adapter);
      const store = new PluginStateStore(this.state, async (st) => {
        this.state = st;
        await this.persist();
      });
      const engine = new SyncEngine({
        webdav,
        vault,
        state: store,
        settings: this.settings,
        onProgress: (done, total) => this.status.setSyncing(done, total),
      });

      this.status.setSyncing(0, 0);
      const stats = await engine.run();
      this.status.setSynced(this.state.lastSync ?? Date.now());
      if (stats.notModified) {
        new Notice("Already up to date");
      } else {
        new Notice(`Synced ${stats.downloaded}, failed ${stats.failed}, deleted ${stats.deleted}`);
      }
    } catch (err) {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        this.status.setOffline();
      } else {
        this.status.setFailed();
        new Notice(`Sync failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      this.syncing = false;
    }
  }

  async resetState(): Promise<void> {
    this.state = { fileState: {} };
    await this.persist();
    new Notice("Local sync state reset — next sync re-downloads everything");
  }

  async saveSettings(): Promise<void> {
    await this.persist();
  }

  private async loadStored(): Promise<void> {
    const data = (await this.loadData()) as Partial<StoredData> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(data?.settings ?? {}) };
    this.state = data?.state ?? { fileState: {} };
  }

  private async persist(): Promise<void> {
    const data: StoredData = { settings: this.settings, state: this.state };
    await this.saveData(data);
  }
}
