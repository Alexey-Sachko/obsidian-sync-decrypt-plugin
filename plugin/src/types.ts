import type { Bytes, Manifest, ManifestFile } from "crypto-core";

export interface PluginSettings {
  webdavUrl: string;
  webdavUser: string;
  webdavPass: string;
  passphrase: string;
  remoteBase: string;
  targetFolder: string;
  deleteMissing: boolean;
}

export interface PersistedState {
  fileState: Record<string, { sha256: string }>;
  lastSync?: number;
  manifestEtag?: string;
}

export interface WebDavClient {
  /** GET remoteBase/name → raw bytes. Throws on network/HTTP failure. */
  get(name: string): Promise<Bytes>;
}

export interface VaultWriter {
  /** Create parent dirs as needed and write the file. */
  writeBinary(path: string, data: Bytes): Promise<void>;
  remove(path: string): Promise<void>;
}

export interface StateStore {
  get(): PersistedState;
  set(next: PersistedState): void;
  save(): Promise<void>;
}

export interface SyncStats {
  downloaded: number;
  failed: number;
  deleted: number;
}

/** Structural subset of Obsidian's requestUrl (type-only; no runtime import). */
export interface RequestArg {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  throw?: boolean;
}
export interface RequestResponse {
  status: number;
  arrayBuffer: ArrayBuffer;
}
export type RequestFn = (arg: RequestArg) => Promise<RequestResponse>;

/** Structural subset of Obsidian's DataAdapter. */
export interface VaultAdapterLike {
  mkdir(path: string): Promise<void>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
  remove(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export type { Bytes, Manifest, ManifestFile };
