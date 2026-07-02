import type { Bytes, Manifest } from "crypto-core";

export interface StateFileEntry {
  sha256: string;
  name: string;
  mtime: number;
}

export interface SyncState {
  salt: Bytes;
  files: Record<string, StateFileEntry>;
}

export interface SourceFile {
  /** Vault-relative POSIX path, e.g. "Notes/idea.md". */
  path: string;
  mtime: number;
  size: number;
}

export interface SourceFs {
  walk(): Promise<SourceFile[]>;
  read(path: string): Promise<Bytes>;
}

export interface WebDav {
  put(name: string, body: Bytes): Promise<void>;
  del(name: string): Promise<void>;
}

export interface SyncStats {
  uploaded: number;
  skipped: number;
  deleted: number;
}

export interface EncryptorConfig {
  webdavUrl: string;
  webdavUser: string;
  webdavPass: string;
  passphrase: string;
  sourceDir: string;
  statePath: string;
  ignore: string[];
  backend: "webdav" | "yandex";
  yandexToken: string;
  remoteBase: string;
}

export type { Bytes, Manifest };
