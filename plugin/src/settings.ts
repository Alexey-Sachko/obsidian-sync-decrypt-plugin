import { PluginSettingTab, Setting } from "obsidian";
import type WebDavDecryptSyncPlugin from "./main.js";
import type { PluginSettings } from "./types.js";
import { INTERVAL_PRESETS } from "./interval.js";
import { validateSettings, testConnection } from "./validate.js";

export const DEFAULT_SETTINGS: PluginSettings = {
  webdavUrl: "",
  webdavUser: "",
  webdavPass: "",
  passphrase: "",
  remoteBase: "",
  targetFolder: "",
  deleteMissing: true,
  syncInterval: 0,
  syncOnOpen: true,
  backend: "webdav",
  yandexToken: "",
};

const STRING_KEYS = [
  "webdavUrl",
  "webdavUser",
  "webdavPass",
  "passphrase",
  "remoteBase",
  "targetFolder",
  "yandexToken",
] as const;
type StringKey = (typeof STRING_KEYS)[number];

export class SyncSettingsTab extends PluginSettingTab {
  constructor(private readonly plugin: WebDavDecryptSyncPlugin) {
    super(plugin.app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;

    const textField = (name: string, desc: string, key: StringKey, password = false): void => {
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addText((t) => {
          t.setValue(s[key]).onChange(async (v) => {
            s[key] = v;
            await this.plugin.saveSettings();
          });
          if (password) t.inputEl.type = "password";
        });
    };

    new Setting(containerEl)
      .setName("Backend")
      .setDesc("WebDAV server or Yandex.Disk (REST API)")
      .addDropdown((d) => {
        d.addOption("webdav", "WebDAV");
        d.addOption("yandex", "Yandex.Disk");
        d.setValue(s.backend).onChange(async (v) => {
          s.backend = v === "yandex" ? "yandex" : "webdav";
          await this.plugin.saveSettings();
          this.display(); // re-render to show relevant fields
        });
      });

    if (s.backend === "webdav") {
      textField("WebDAV URL", "Base URL of the WebDAV server", "webdavUrl");
      textField("Username", "WebDAV user", "webdavUser");
      textField("Password", "WebDAV password", "webdavPass", true);
    } else {
      textField(
        "Yandex.Disk OAuth token",
        "Access token with cloud_api:disk.read/write",
        "yandexToken",
        true,
      );
    }
    textField("Passphrase", "Decryption passphrase (same as the encryptor)", "passphrase", true);
    textField(
      "Remote base",
      s.backend === "yandex" ? "Folder on the Disk (e.g. second-brain)" : "Subpath on the server (optional)",
      "remoteBase",
    );
    textField("Target folder", "Vault folder to write into (default: root)", "targetFolder");

    new Setting(containerEl)
      .setName("Delete missing files")
      .setDesc("Remove local files no longer present in the manifest")
      .addToggle((t) =>
        t.setValue(s.deleteMissing).onChange(async (v) => {
          s.deleteMissing = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Sync interval")
      .setDesc("Runs only while Obsidian is open — iOS has no background sync")
      .addDropdown((d) => {
        for (const p of INTERVAL_PRESETS) d.addOption(String(p.minutes), p.label);
        d.setValue(String(s.syncInterval)).onChange(async (v) => {
          s.syncInterval = Number(v);
          await this.plugin.saveSettings();
          this.plugin.applySchedule();
        });
      });

    new Setting(containerEl)
      .setName("Sync on open")
      .setDesc("Sync once when Obsidian finishes loading")
      .addToggle((t) =>
        t.setValue(s.syncOnOpen).onChange(async (v) => {
          s.syncOnOpen = v;
          await this.plugin.saveSettings();
        }),
      );

    const status = containerEl.createEl("p", { text: "" });
    status.style.opacity = "0.8";

    new Setting(containerEl)
      .setName("Test connection")
      .setDesc("Check URL, credentials, and that manifest.enc is reachable")
      .addButton((b) =>
        b.setButtonText("Test").onClick(async () => {
          const errs = validateSettings(s);
          if (errs.length) {
            status.setText("⚠ " + errs.join("; "));
            return;
          }
          status.setText("Testing…");
          const res = await testConnection(this.plugin.makeClient());
          status.setText(res.ok ? "✓ Connection OK" : "✗ " + res.message);
        }),
      );

    new Setting(containerEl)
      .setName("Sync now")
      .addButton((b) =>
        b
          .setButtonText("Sync now")
          .setCta()
          .onClick(() => void this.plugin.syncNow()),
      );
  }
}
