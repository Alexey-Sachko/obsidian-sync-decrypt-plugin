import {
  deriveKeys,
  deriveName,
  encryptBlob,
  encryptManifest,
  sha256Hex,
  type Manifest,
} from "crypto-core";
import type { SourceFs, SyncState, SyncStats, WebDav } from "./types.js";

export interface EncryptSyncDeps {
  source: SourceFs;
  webdav: WebDav;
  passphrase: string;
  state: SyncState;
  full?: boolean;
  now?: () => Date;
}

export interface EncryptSyncResult {
  state: SyncState;
  stats: SyncStats;
}

export async function encryptSync(deps: EncryptSyncDeps): Promise<EncryptSyncResult> {
  const { source, webdav, passphrase, state } = deps;
  const now = deps.now ?? (() => new Date());
  const full = deps.full ?? false;

  const { contentKey, nameKey } = await deriveKeys(passphrase, state.salt);

  const files = await source.walk();
  const nextFiles: SyncState["files"] = {};
  const manifestFiles: Manifest["files"] = [];
  const stats: SyncStats = { uploaded: 0, skipped: 0, deleted: 0 };

  for (const file of files) {
    const plaintext = await source.read(file.path);
    const sha = await sha256Hex(plaintext);
    const name = await deriveName(nameKey, file.path);
    const prior = state.files[file.path];

    if (!full && prior && prior.sha256 === sha) {
      stats.skipped++;
    } else {
      const blob = await encryptBlob(contentKey, plaintext);
      await webdav.put(name, blob);
      stats.uploaded++;
    }

    nextFiles[file.path] = { sha256: sha, name, mtime: file.mtime };
    manifestFiles.push({
      path: file.path,
      name,
      size: plaintext.length,
      sha256: sha,
      mtime: file.mtime,
    });
  }

  for (const [path, entry] of Object.entries(state.files)) {
    if (!nextFiles[path]) {
      await webdav.del(entry.name);
      stats.deleted++;
    }
  }

  manifestFiles.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const manifest: Manifest = {
    version: 1,
    generatedAt: now().toISOString(),
    files: manifestFiles,
  };
  const enc = await encryptManifest(manifest, state.salt, contentKey);
  await webdav.put("manifest.enc", enc);

  return { state: { salt: state.salt, files: nextFiles }, stats };
}
