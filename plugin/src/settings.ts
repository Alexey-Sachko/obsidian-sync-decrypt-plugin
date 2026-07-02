import { PluginSettingTab, Setting } from "obsidian";
import type WebDavDecryptSyncPlugin from "./main.js";
import type { PluginSettings } from "./types.js";

export const DEFAULT_SETTINGS: PluginSettings = {
  webdavUrl: "",
  webdavUser: "",
  webdavPass: "",
  passphrase: "",
  remoteBase: "",
  targetFolder: "",
  deleteMissing: true,
};

const STRING_KEYS = [
  "webdavUrl",
  "webdavUser",
  "webdavPass",
  "passphrase",
  "remoteBase",
  "targetFolder",
] as const;
type StringKey = (typeof STRING_KEYS)[number];

export class SyncSettingsTab extends PluginSettingTab {
  constructor(private readonly plugin: WebDavDecryptSyncPlugin) {
    super(plugin.app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const textField = (name: string, desc: string, key: StringKey, password = false): void => {
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addText((t) => {
          t.setValue(this.plugin.settings[key]).onChange(async (v) => {
            this.plugin.settings[key] = v;
            await this.plugin.saveSettings();
          });
          if (password) t.inputEl.type = "password";
        });
    };

    textField("WebDAV URL", "Base URL of the WebDAV server", "webdavUrl");
    textField("Username", "WebDAV user", "webdavUser");
    textField("Password", "WebDAV password", "webdavPass", true);
    textField("Passphrase", "Decryption passphrase (same as the encryptor)", "passphrase", true);
    textField("Remote base", "Subpath on the server (optional)", "remoteBase");
    textField("Target folder", "Vault folder to write into (default: root)", "targetFolder");

    new Setting(containerEl)
      .setName("Delete missing files")
      .setDesc("Remove local files no longer present in the manifest")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.deleteMissing).onChange(async (v) => {
          this.plugin.settings.deleteMissing = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Sync now")
      .setDesc("iOS has no background sync — sync runs only while the app is open")
      .addButton((b) =>
        b
          .setButtonText("Sync now")
          .setCta()
          .onClick(() => void this.plugin.syncNow()),
      );
  }
}
