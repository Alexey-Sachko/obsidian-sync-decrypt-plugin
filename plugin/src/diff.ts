import type { Manifest, ManifestFile } from "crypto-core";
import type { PersistedState } from "./types.js";

export interface SyncDiff {
  toDownload: ManifestFile[];
  toDelete: string[];
}

export function computeDiff(
  manifest: Manifest,
  state: PersistedState,
  deleteMissing: boolean,
): SyncDiff {
  const toDownload = manifest.files.filter(
    (f) => state.fileState[f.path]?.sha256 !== f.sha256,
  );

  let toDelete: string[] = [];
  if (deleteMissing) {
    const inManifest = new Set(manifest.files.map((f) => f.path));
    toDelete = Object.keys(state.fileState).filter((p) => !inManifest.has(p));
  }

  return { toDownload, toDelete };
}
