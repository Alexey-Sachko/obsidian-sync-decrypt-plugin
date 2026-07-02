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
  onProgress?: (done: number, total: number) => void;
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

    const current = state.get();

    // Conditional manifest fetch: 304 means nothing changed since last sync.
    const manifestRes = await webdav.getConditional(MANIFEST_NAME, current.manifestEtag);
    if (manifestRes.status === 304) {
      current.lastSync = Date.now();
      state.set(current);
      await state.save();
      return { downloaded: 0, failed: 0, deleted: 0, notModified: true };
    }

    // Decrypt manifest; wrong passphrase throws here, before any write.
    const manifestBytes = manifestRes.body!;
    const salt = readManifestSalt(manifestBytes);
    const { contentKey } = await deriveKeys(settings.passphrase, salt);
    const manifest = await decryptManifest(manifestBytes, contentKey);

    const { toDownload, toDelete } = computeDiff(manifest, current, settings.deleteMissing);

    const total = toDownload.length;
    let processed = 0;
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
      processed++;
      this.deps.onProgress?.(processed, total);
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
    current.manifestEtag = manifestRes.etag;
    state.set(current);
    await state.save();

    return stats;
  }
}
