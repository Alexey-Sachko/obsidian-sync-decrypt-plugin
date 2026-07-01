export interface DerivedKeys {
  /** AES-GCM 256-bit key for file/manifest content. */
  contentKey: CryptoKey;
  /** HMAC-SHA-256 key for deterministic remote names. */
  nameKey: CryptoKey;
  /** The 16-byte salt these keys were derived from. */
  salt: Uint8Array;
}

export interface ManifestFile {
  /** Real path inside the vault, e.g. "Notes/idea.md". */
  path: string;
  /** remoteName = base32(HMAC(nameKey, path)). */
  name: string;
  /** Plaintext size in bytes. */
  size: number;
  /** Lowercase hex SHA-256 of plaintext content (change detector). */
  sha256: string;
  /** Source mtime (epoch seconds), informational. */
  mtime: number;
}

export interface Manifest {
  version: number;
  generatedAt: string;
  files: ManifestFile[];
}
