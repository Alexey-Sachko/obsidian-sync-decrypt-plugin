import { Notice, Plugin, requestUrl } from "obsidian";
import type { PersistedState, PluginSettings, RequestFn } from "./types.js";
import { DEFAULT_SETTINGS, SyncSettingsTab } from "./settings.js";
import { ObsidianWebDavClient } from "./webdav.js";
import { ObsidianVaultWriter } from "./vault-writer.js";
import { PluginStateStore } from "./state-store.js";
import { SyncEngine } from "./engine.js";

interface StoredData {
  settings: PluginSettings;
  state: PersistedState;
}

export default class WebDavDecryptSyncPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  private state: PersistedState = { fileState: {} };

  async onload(): Promise<void> {
    await this.loadStored();

    this.addCommand({
      id: "sync-now",
      name: "Sync now",
      callback: () => void this.syncNow(),
    });

    this.addSettingTab(new SyncSettingsTab(this));
  }

  async syncNow(): Promise<void> {
    try {
      const request: RequestFn = async (arg) => {
        const res = await requestUrl({
          url: arg.url,
          method: arg.method,
          headers: arg.headers,
          throw: false,
        });
        return { status: res.status, arrayBuffer: res.arrayBuffer };
      };

      const webdav = new ObsidianWebDavClient({
        baseUrl: this.settings.webdavUrl,
        remoteBase: this.settings.remoteBase,
        user: this.settings.webdavUser,
        pass: this.settings.webdavPass,
        request,
      });
      const vault = new ObsidianVaultWriter(this.app.vault.adapter);
      const store = new PluginStateStore(this.state, async (s) => {
        this.state = s;
        await this.persist();
      });
      const engine = new SyncEngine({ webdav, vault, state: store, settings: this.settings });

      new Notice("Sync started…");
      const stats = await engine.run();
      new Notice(`Synced ${stats.downloaded}, failed ${stats.failed}, deleted ${stats.deleted}`);
    } catch (err) {
      new Notice(`Sync failed: ${err instanceof Error ? err.message : String(err)}`);
    }
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
