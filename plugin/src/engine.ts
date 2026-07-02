import { decryptBlob, decryptManifest, deriveKeys, readManifestSalt } from "crypto-core";
import { computeDiff } from "./diff.js";
import { joinVaultPath } from "./paths.js";
import type {
  PluginSettings,
  StateStore,
  SyncStats,
  VaultWriter,
  WebDavClient,
} from "./types.js";

const MANIFEST_NAME = "manifest.enc";

export interface SyncEngineDeps {
  webdav: WebDavClient;
  vault: VaultWriter;
  state: StateStore;
  settings: PluginSettings;
}

export class SyncEngine {
  private isSyncing = false;

  constructor(private readonly deps: SyncEngineDeps) {}

  async run(): Promise<SyncStats> {
    if (this.isSyncing) throw new Error("Sync already in progress");
    this.isSyncing = true;
    try {
      return await this.doRun();
    } finally {
      this.isSyncing = false;
    }
  }

  private async doRun(): Promise<SyncStats> {
    const { webdav, vault, state, settings } = this.deps;
    const stats: SyncStats = { downloaded: 0, failed: 0, deleted: 0 };

    // Fetch + decrypt manifest first; wrong passphrase throws here, before any write.
    const manifestBytes = await webdav.get(MANIFEST_NAME);
    const salt = readManifestSalt(manifestBytes);
    const { contentKey } = await deriveKeys(settings.passphrase, salt);
    const manifest = await decryptManifest(manifestBytes, contentKey);

    const current = state.get();
    const { toDownload, toDelete } = computeDiff(manifest, current, settings.deleteMissing);

    for (const file of toDownload) {
      try {
        const blob = await webdav.get(file.name);
        const plain = await decryptBlob(contentKey, blob);
        await vault.writeBinary(joinVaultPath(settings.targetFolder, file.path), plain);
        current.fileState[file.path] = { sha256: file.sha256 };
        stats.downloaded++;
      } catch {
        // Per-file failure: leave state untouched so the file retries next sync.
        stats.failed++;
      }
    }

    for (const path of toDelete) {
      try {
        await vault.remove(joinVaultPath(settings.targetFolder, path));
      } catch {
        // Ignore remove failures (file may already be gone).
      }
      delete current.fileState[path];
      stats.deleted++;
    }

    current.lastSync = Date.now();
    state.set(current);
    await state.save();

    return stats;
  }
}
