# M0 · crypto-core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared `crypto-core` TypeScript module that defines the on-disk encryption format used identically by the VPS encryptor CLI and the Obsidian plugin, protected by round-trip, determinism, and golden-vector tests.

**Architecture:** Pure Web Crypto (`globalThis.crypto.subtle`) — no WASM, no npm crypto libs, no Node `Buffer` or `node:crypto`, no browser-only APIs. Only cross-platform primitives (`Uint8Array`, `TextEncoder`/`TextDecoder`) that behave identically on Node ≥ 20 and iOS WebView. Every public function is async (Web Crypto is promise-based). The master key is derived once via PBKDF2 then split with HKDF into a content key and a name key; that derivation is reused for all files in a sync.

**Tech Stack:** TypeScript, Web Crypto API, Vitest (runs in Node 20 which exposes `globalThis.crypto`), tsup/esbuild-compatible ESM output.

---

## Locked format decisions (must match SPEC §2; changing any = version bump + regenerate golden vectors)

- **PBKDF2:** HMAC-SHA-256, `iterations = 200_000`, 16-byte salt → 32 raw bytes (`rootBits`).
- **HKDF:** SHA-256, **salt = empty (zero-length `Uint8Array`)** (rootBits is already high-entropy), `info` per key:
  - `contentKey` — `info = utf8("content/v1")`, output = AES-GCM 256-bit key (`encrypt`/`decrypt`).
  - `nameKey` — `info = utf8("filename/v1")`, output = HMAC-SHA-256 key (`sign`).
- **Blob format:** `[magic(4)="OSD1"][version(1)=0x01][iv(12)][ciphertext+gcmTag]`. IV random per file; 16-byte GCM tag appended by Web Crypto.
- **Manifest format:** `[magic(4)="OSDM"][version(1)=0x01][salt(16)][iv(12)][ciphertext+gcmTag]`. Salt is plaintext, read **before** key derivation. Body = UTF-8 JSON.
- **Remote name:** `base32_nopad(HMAC-SHA-256(nameKey, utf8(realPath)))`. Base32 alphabet = **RFC 4648 lowercase** `abcdefghijklmnopqrstuvwxyz234567`, no padding. 32 bytes → 52 chars.
- **sha256:** lowercase hex of `SHA-256(plaintextBytes)`.
- Magic/version are validated on decode; mismatch throws before any decrypt attempt.

## File structure

- `crypto-core/package.json` — package manifest, `"type": "module"`, test/build scripts.
- `crypto-core/tsconfig.json` — strict TS, ESNext, no DOM-only libs required beyond what Node/WebView share.
- `crypto-core/vitest.config.ts` — Vitest config (node environment).
- `crypto-core/src/bytes.ts` — byte helpers: `utf8Encode`, `utf8Decode`, `concatBytes`, `toHex`, `equalBytes`. No Buffer.
- `crypto-core/src/base32.ts` — `base32NoPadEncode(bytes): string` (lowercase RFC 4648).
- `crypto-core/src/types.ts` — `DerivedKeys`, `ManifestFile`, `Manifest`.
- `crypto-core/src/keys.ts` — `deriveKeys(passphrase, salt): Promise<DerivedKeys>`.
- `crypto-core/src/name.ts` — `deriveName(nameKey, realPath): Promise<string>`.
- `crypto-core/src/blob.ts` — `encryptBlob`, `decryptBlob`.
- `crypto-core/src/manifest.ts` — `readManifestSalt`, `encryptManifest`, `decryptManifest`.
- `crypto-core/src/sha256.ts` — `sha256Hex(bytes): Promise<string>`.
- `crypto-core/src/index.ts` — public re-exports.
- `crypto-core/test/*.test.ts` — one test file per module + `golden.test.ts`.

---

### Task 1: Package scaffold

**Files:**
- Create: `crypto-core/package.json`, `crypto-core/tsconfig.json`, `crypto-core/vitest.config.ts`

- [ ] **Step 1: Write `crypto-core/package.json`**

```json
{
  "name": "crypto-core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Write `crypto-core/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"],
    "declaration": true,
    "outDir": "dist"
  },
  "include": ["src", "test"]
}
```

Note: `"types": ["node"]` only for `@types/node` test tooling; production code must not import `node:*`. `globalThis.crypto` is used untyped-safe via `crypto.subtle`.

- [ ] **Step 3: Write `crypto-core/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Install deps**

Run: `cd crypto-core && npm install`
Expected: creates `node_modules`, `package-lock.json`, no errors.

- [ ] **Step 5: Commit**

```bash
git add crypto-core/package.json crypto-core/tsconfig.json crypto-core/vitest.config.ts crypto-core/package-lock.json
git commit -m "chore(crypto-core): package scaffold"
```

---

### Task 2: Byte helpers (`bytes.ts`)

**Files:**
- Create: `crypto-core/src/bytes.ts`
- Test: `crypto-core/test/bytes.test.ts`

- [ ] **Step 1: Write the failing test** — `crypto-core/test/bytes.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { utf8Encode, utf8Decode, concatBytes, toHex, equalBytes } from "../src/bytes.js";

describe("bytes", () => {
  it("utf8 round-trips including non-ascii", () => {
    const s = "Notes/idée.md";
    expect(utf8Decode(utf8Encode(s))).toBe(s);
  });

  it("concatBytes joins in order", () => {
    const out = concatBytes(new Uint8Array([1, 2]), new Uint8Array([3]));
    expect([...out]).toEqual([1, 2, 3]);
  });

  it("toHex is lowercase, zero-padded", () => {
    expect(toHex(new Uint8Array([0, 15, 255]))).toBe("000fff");
  });

  it("equalBytes is true only for identical content", () => {
    expect(equalBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(equalBytes(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(equalBytes(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd crypto-core && npx vitest run test/bytes.test.ts`
Expected: FAIL — cannot resolve `../src/bytes.js`.

- [ ] **Step 3: Write `crypto-core/src/bytes.ts`**

```ts
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function utf8Encode(s: string): Uint8Array {
  return encoder.encode(s);
}

export function utf8Decode(b: Uint8Array): string {
  return decoder.decode(b);
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function toHex(b: Uint8Array): string {
  let s = "";
  for (const byte of b) s += byte.toString(16).padStart(2, "0");
  return s;
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd crypto-core && npx vitest run test/bytes.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add crypto-core/src/bytes.ts crypto-core/test/bytes.test.ts
git commit -m "feat(crypto-core): byte helpers"
```

---

### Task 3: Base32 no-pad encoder (`base32.ts`)

**Files:**
- Create: `crypto-core/src/base32.ts`
- Test: `crypto-core/test/base32.test.ts`

- [ ] **Step 1: Write the failing test** — `crypto-core/test/base32.test.ts`

RFC 4648 test vectors (lowercased, padding stripped): `"foobar"` → `mzxw6ytboi`.

```ts
import { describe, it, expect } from "vitest";
import { base32NoPadEncode } from "../src/base32.js";
import { utf8Encode } from "../src/bytes.js";

describe("base32NoPadEncode", () => {
  it("matches RFC 4648 vectors (lowercase, no padding)", () => {
    expect(base32NoPadEncode(utf8Encode(""))).toBe("");
    expect(base32NoPadEncode(utf8Encode("f"))).toBe("my");
    expect(base32NoPadEncode(utf8Encode("fo"))).toBe("mzxq");
    expect(base32NoPadEncode(utf8Encode("foo"))).toBe("mzxw6");
    expect(base32NoPadEncode(utf8Encode("foob"))).toBe("mzxw6yq");
    expect(base32NoPadEncode(utf8Encode("fooba"))).toBe("mzxw6ytb");
    expect(base32NoPadEncode(utf8Encode("foobar"))).toBe("mzxw6ytboi");
  });

  it("encodes 32 bytes to 52 chars", () => {
    expect(base32NoPadEncode(new Uint8Array(32)).length).toBe(52);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd crypto-core && npx vitest run test/base32.test.ts`
Expected: FAIL — cannot resolve `../src/base32.js`.

- [ ] **Step 3: Write `crypto-core/src/base32.ts`**

```ts
const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

export function base32NoPadEncode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(value >>> bits) & 31];
    }
  }
  if (bits > 0) {
    out += ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd crypto-core && npx vitest run test/base32.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add crypto-core/src/base32.ts crypto-core/test/base32.test.ts
git commit -m "feat(crypto-core): base32 no-pad encoder"
```

---

### Task 4: Shared types (`types.ts`)

**Files:**
- Create: `crypto-core/src/types.ts`

- [ ] **Step 1: Write `crypto-core/src/types.ts`** (no test — pure type declarations)

```ts
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
```

- [ ] **Step 2: Commit**

```bash
git add crypto-core/src/types.ts
git commit -m "feat(crypto-core): shared types"
```

---

### Task 5: Key derivation (`keys.ts`)

**Files:**
- Create: `crypto-core/src/keys.ts`
- Test: `crypto-core/test/keys.test.ts`

- [ ] **Step 1: Write the failing test** — `crypto-core/test/keys.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { deriveKeys } from "../src/keys.js";

const salt = new Uint8Array(16).fill(7);

describe("deriveKeys", () => {
  it("returns an AES-GCM contentKey and HMAC nameKey", async () => {
    const keys = await deriveKeys("correct horse", salt);
    expect(keys.contentKey.algorithm.name).toBe("AES-GCM");
    expect(keys.nameKey.algorithm.name).toBe("HMAC");
    expect([...keys.salt]).toEqual([...salt]);
  });

  it("is deterministic for same passphrase+salt (same name output)", async () => {
    const a = await deriveKeys("pw", salt);
    const b = await deriveKeys("pw", salt);
    const msg = new Uint8Array([1, 2, 3]);
    const sa = new Uint8Array(await crypto.subtle.sign("HMAC", a.nameKey, msg));
    const sb = new Uint8Array(await crypto.subtle.sign("HMAC", b.nameKey, msg));
    expect([...sa]).toEqual([...sb]);
  });

  it("different passphrase yields different nameKey output", async () => {
    const a = await deriveKeys("pw1", salt);
    const b = await deriveKeys("pw2", salt);
    const msg = new Uint8Array([1, 2, 3]);
    const sa = new Uint8Array(await crypto.subtle.sign("HMAC", a.nameKey, msg));
    const sb = new Uint8Array(await crypto.subtle.sign("HMAC", b.nameKey, msg));
    expect([...sa]).not.toEqual([...sb]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd crypto-core && npx vitest run test/keys.test.ts`
Expected: FAIL — cannot resolve `../src/keys.js`.

- [ ] **Step 3: Write `crypto-core/src/keys.ts`**

```ts
import { utf8Encode } from "./bytes.js";
import type { DerivedKeys } from "./types.js";

const PBKDF2_ITERATIONS = 200_000;
const EMPTY_SALT = new Uint8Array(0);

export async function deriveKeys(passphrase: string, salt: Uint8Array): Promise<DerivedKeys> {
  const passKey = await crypto.subtle.importKey(
    "raw",
    utf8Encode(passphrase),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const rootBits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    passKey,
    256,
  );

  const hkdfKey = await crypto.subtle.importKey(
    "raw",
    rootBits,
    "HKDF",
    false,
    ["deriveKey"],
  );

  const contentKey = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: EMPTY_SALT, info: utf8Encode("content/v1") },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );

  const nameKey = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: EMPTY_SALT, info: utf8Encode("filename/v1") },
    hkdfKey,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"],
  );

  return { contentKey, nameKey, salt };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd crypto-core && npx vitest run test/keys.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add crypto-core/src/keys.ts crypto-core/test/keys.test.ts
git commit -m "feat(crypto-core): PBKDF2+HKDF key derivation"
```

---

### Task 6: Deterministic names (`name.ts`)

**Files:**
- Create: `crypto-core/src/name.ts`
- Test: `crypto-core/test/name.test.ts`

- [ ] **Step 1: Write the failing test** — `crypto-core/test/name.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { deriveKeys } from "../src/keys.js";
import { deriveName } from "../src/name.js";

const salt = new Uint8Array(16).fill(7);

describe("deriveName", () => {
  it("is deterministic and base32 (52 chars, lowercase alnum)", async () => {
    const { nameKey } = await deriveKeys("pw", salt);
    const n1 = await deriveName(nameKey, "Notes/idea.md");
    const n2 = await deriveName(nameKey, "Notes/idea.md");
    expect(n1).toBe(n2);
    expect(n1).toMatch(/^[a-z2-7]{52}$/);
  });

  it("different paths produce different names", async () => {
    const { nameKey } = await deriveKeys("pw", salt);
    expect(await deriveName(nameKey, "a.md")).not.toBe(await deriveName(nameKey, "b.md"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd crypto-core && npx vitest run test/name.test.ts`
Expected: FAIL — cannot resolve `../src/name.js`.

- [ ] **Step 3: Write `crypto-core/src/name.ts`**

```ts
import { base32NoPadEncode } from "./base32.js";
import { utf8Encode } from "./bytes.js";

export async function deriveName(nameKey: CryptoKey, realPath: string): Promise<string> {
  const mac = await crypto.subtle.sign("HMAC", nameKey, utf8Encode(realPath));
  return base32NoPadEncode(new Uint8Array(mac));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd crypto-core && npx vitest run test/name.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add crypto-core/src/name.ts crypto-core/test/name.test.ts
git commit -m "feat(crypto-core): deterministic remote names"
```

---

### Task 7: Blob encrypt/decrypt (`blob.ts`)

**Files:**
- Create: `crypto-core/src/blob.ts`
- Test: `crypto-core/test/blob.test.ts`

Design note: `encryptBlob` takes an optional `iv` param (defaults to random 12 bytes) so golden-vector tests can pin the IV. Production callers omit it.

- [ ] **Step 1: Write the failing test** — `crypto-core/test/blob.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { deriveKeys } from "../src/keys.js";
import { encryptBlob, decryptBlob } from "../src/blob.js";
import { utf8Encode, utf8Decode } from "../src/bytes.js";

const salt = new Uint8Array(16).fill(7);

describe("blob", () => {
  it("round-trips arbitrary bytes", async () => {
    const { contentKey } = await deriveKeys("pw", salt);
    const plain = utf8Encode("# Hello\nこんにちは\n");
    const blob = await encryptBlob(contentKey, plain);
    const out = await decryptBlob(contentKey, blob);
    expect(utf8Decode(out)).toBe("# Hello\nこんにちは\n");
  });

  it("starts with magic OSD1 and version 0x01", async () => {
    const { contentKey } = await deriveKeys("pw", salt);
    const blob = await encryptBlob(contentKey, new Uint8Array([9]));
    expect(utf8Decode(blob.slice(0, 4))).toBe("OSD1");
    expect(blob[4]).toBe(0x01);
  });

  it("rejects wrong magic before decrypting", async () => {
    const { contentKey } = await deriveKeys("pw", salt);
    const blob = await encryptBlob(contentKey, new Uint8Array([9]));
    blob[0] = 0x00;
    await expect(decryptBlob(contentKey, blob)).rejects.toThrow(/magic/i);
  });

  it("fails auth with wrong key (tampered/ wrong passphrase)", async () => {
    const a = await deriveKeys("pw1", salt);
    const b = await deriveKeys("pw2", salt);
    const blob = await encryptBlob(a.contentKey, new Uint8Array([1, 2, 3]));
    await expect(decryptBlob(b.contentKey, blob)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd crypto-core && npx vitest run test/blob.test.ts`
Expected: FAIL — cannot resolve `../src/blob.js`.

- [ ] **Step 3: Write `crypto-core/src/blob.ts`**

```ts
import { concatBytes, equalBytes, utf8Encode } from "./bytes.js";

const MAGIC = utf8Encode("OSD1"); // 4 bytes
const VERSION = 0x01;
const IV_LEN = 12;
const HEADER_LEN = 4 + 1 + IV_LEN;

export async function encryptBlob(
  contentKey: CryptoKey,
  plaintext: Uint8Array,
  iv: Uint8Array = crypto.getRandomValues(new Uint8Array(IV_LEN)),
): Promise<Uint8Array> {
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, contentKey, plaintext),
  );
  return concatBytes(MAGIC, new Uint8Array([VERSION]), iv, ct);
}

export async function decryptBlob(contentKey: CryptoKey, blob: Uint8Array): Promise<Uint8Array> {
  if (blob.length < HEADER_LEN) throw new Error("Blob too short");
  if (!equalBytes(blob.slice(0, 4), MAGIC)) throw new Error("Bad blob magic");
  if (blob[4] !== VERSION) throw new Error(`Unsupported blob version ${blob[4]}`);
  const iv = blob.slice(5, 5 + IV_LEN);
  const ct = blob.slice(HEADER_LEN);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, contentKey, ct);
  return new Uint8Array(plain);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd crypto-core && npx vitest run test/blob.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add crypto-core/src/blob.ts crypto-core/test/blob.test.ts
git commit -m "feat(crypto-core): AES-GCM blob codec"
```

---

### Task 8: sha256 helper (`sha256.ts`)

**Files:**
- Create: `crypto-core/src/sha256.ts`
- Test: `crypto-core/test/sha256.test.ts`

- [ ] **Step 1: Write the failing test** — `crypto-core/test/sha256.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { sha256Hex } from "../src/sha256.js";
import { utf8Encode } from "../src/bytes.js";

describe("sha256Hex", () => {
  it("matches known vector for empty input", async () => {
    expect(await sha256Hex(new Uint8Array(0))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("matches known vector for 'abc'", async () => {
    expect(await sha256Hex(utf8Encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd crypto-core && npx vitest run test/sha256.test.ts`
Expected: FAIL — cannot resolve `../src/sha256.js`.

- [ ] **Step 3: Write `crypto-core/src/sha256.ts`**

```ts
import { toHex } from "./bytes.js";

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return toHex(new Uint8Array(digest));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd crypto-core && npx vitest run test/sha256.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add crypto-core/src/sha256.ts crypto-core/test/sha256.test.ts
git commit -m "feat(crypto-core): sha256 hex helper"
```

---

### Task 9: Manifest codec (`manifest.ts`)

**Files:**
- Create: `crypto-core/src/manifest.ts`
- Test: `crypto-core/test/manifest.test.ts`

Design note: `encryptManifest(manifest, salt, contentKey, iv?)` writes `[OSDM][ver][salt][iv][ct]`. Decrypt is two-step so the plugin can derive keys from the embedded salt: `readManifestSalt(bytes)` → `deriveKeys` → `decryptManifest(bytes, contentKey)`.

- [ ] **Step 1: Write the failing test** — `crypto-core/test/manifest.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { deriveKeys } from "../src/keys.js";
import { readManifestSalt, encryptManifest, decryptManifest } from "../src/manifest.js";
import { utf8Decode } from "../src/bytes.js";
import type { Manifest } from "../src/types.js";

const salt = new Uint8Array(16).fill(7);
const manifest: Manifest = {
  version: 1,
  generatedAt: "2026-07-01T10:00:00Z",
  files: [{ path: "Notes/idea.md", name: "abc", size: 3, sha256: "de", mtime: 100 }],
};

describe("manifest codec", () => {
  it("round-trips via embedded salt", async () => {
    const { contentKey } = await deriveKeys("pw", salt);
    const enc = await encryptManifest(manifest, salt, contentKey);

    const readSalt = readManifestSalt(enc);
    expect([...readSalt]).toEqual([...salt]);

    const keys = await deriveKeys("pw", readSalt);
    const out = await decryptManifest(enc, keys.contentKey);
    expect(out).toEqual(manifest);
  });

  it("has magic OSDM and version 0x01", async () => {
    const { contentKey } = await deriveKeys("pw", salt);
    const enc = await encryptManifest(manifest, salt, contentKey);
    expect(utf8Decode(enc.slice(0, 4))).toBe("OSDM");
    expect(enc[4]).toBe(0x01);
  });

  it("wrong passphrase fails to decrypt (bad GCM tag)", async () => {
    const good = await deriveKeys("pw", salt);
    const bad = await deriveKeys("wrong", salt);
    const enc = await encryptManifest(manifest, salt, good.contentKey);
    await expect(decryptManifest(enc, bad.contentKey)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd crypto-core && npx vitest run test/manifest.test.ts`
Expected: FAIL — cannot resolve `../src/manifest.js`.

- [ ] **Step 3: Write `crypto-core/src/manifest.ts`**

```ts
import { concatBytes, equalBytes, utf8Decode, utf8Encode } from "./bytes.js";
import type { Manifest } from "./types.js";

const MAGIC = utf8Encode("OSDM");
const VERSION = 0x01;
const SALT_LEN = 16;
const IV_LEN = 12;
const SALT_OFFSET = 5;
const IV_OFFSET = SALT_OFFSET + SALT_LEN; // 21
const BODY_OFFSET = IV_OFFSET + IV_LEN; // 33

export function readManifestSalt(bytes: Uint8Array): Uint8Array {
  if (bytes.length < BODY_OFFSET) throw new Error("Manifest too short");
  if (!equalBytes(bytes.slice(0, 4), MAGIC)) throw new Error("Bad manifest magic");
  if (bytes[4] !== VERSION) throw new Error(`Unsupported manifest version ${bytes[4]}`);
  return bytes.slice(SALT_OFFSET, SALT_OFFSET + SALT_LEN);
}

export async function encryptManifest(
  manifest: Manifest,
  salt: Uint8Array,
  contentKey: CryptoKey,
  iv: Uint8Array = crypto.getRandomValues(new Uint8Array(IV_LEN)),
): Promise<Uint8Array> {
  if (salt.length !== SALT_LEN) throw new Error("Salt must be 16 bytes");
  const body = utf8Encode(JSON.stringify(manifest));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, contentKey, body),
  );
  return concatBytes(MAGIC, new Uint8Array([VERSION]), salt, iv, ct);
}

export async function decryptManifest(bytes: Uint8Array, contentKey: CryptoKey): Promise<Manifest> {
  readManifestSalt(bytes); // validates magic/version/length
  const iv = bytes.slice(IV_OFFSET, IV_OFFSET + IV_LEN);
  const ct = bytes.slice(BODY_OFFSET);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, contentKey, ct);
  return JSON.parse(utf8Decode(new Uint8Array(plain))) as Manifest;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd crypto-core && npx vitest run test/manifest.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add crypto-core/src/manifest.ts crypto-core/test/manifest.test.ts
git commit -m "feat(crypto-core): manifest.enc codec"
```

---

### Task 10: Public API barrel (`index.ts`)

**Files:**
- Create: `crypto-core/src/index.ts`
- Test: `crypto-core/test/index.test.ts`

- [ ] **Step 1: Write the failing test** — `crypto-core/test/index.test.ts`

```ts
import { describe, it, expect } from "vitest";
import * as core from "../src/index.js";

describe("public API", () => {
  it("exports the full crypto surface", () => {
    for (const name of [
      "deriveKeys",
      "deriveName",
      "encryptBlob",
      "decryptBlob",
      "encryptManifest",
      "decryptManifest",
      "readManifestSalt",
      "sha256Hex",
      "base32NoPadEncode",
    ]) {
      expect(typeof (core as Record<string, unknown>)[name]).toBe("function");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd crypto-core && npx vitest run test/index.test.ts`
Expected: FAIL — cannot resolve `../src/index.js`.

- [ ] **Step 3: Write `crypto-core/src/index.ts`**

```ts
export { deriveKeys } from "./keys.js";
export { deriveName } from "./name.js";
export { encryptBlob, decryptBlob } from "./blob.js";
export { encryptManifest, decryptManifest, readManifestSalt } from "./manifest.js";
export { sha256Hex } from "./sha256.js";
export { base32NoPadEncode } from "./base32.js";
export {
  utf8Encode,
  utf8Decode,
  concatBytes,
  toHex,
  equalBytes,
} from "./bytes.js";
export type { DerivedKeys, Manifest, ManifestFile } from "./types.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd crypto-core && npx vitest run test/index.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add crypto-core/src/index.ts crypto-core/test/index.test.ts
git commit -m "feat(crypto-core): public API barrel"
```

---

### Task 11: Golden vectors (format lock)

**Files:**
- Create: `crypto-core/test/golden.test.ts`

These pin fixed passphrase/salt/iv → fixed ciphertext + fixed derived name, so any accidental format change (iterations, HKDF info/salt, alphabet, header layout) breaks the build. The expected hex constants are **generated once** from the implementation, reviewed against the spec, then frozen.

- [ ] **Step 1: Write the golden test skeleton with placeholder expectations** — `crypto-core/test/golden.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { deriveKeys } from "../src/keys.js";
import { deriveName } from "../src/name.js";
import { encryptBlob } from "../src/blob.js";
import { encryptManifest } from "../src/manifest.js";
import { toHex, utf8Encode } from "../src/bytes.js";
import type { Manifest } from "../src/types.js";

// Fixed inputs — DO NOT CHANGE without a format version bump.
const PASSPHRASE = "golden-passphrase";
const SALT = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
const IV = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
const PLAINTEXT = utf8Encode("golden content\n");
const MANIFEST: Manifest = {
  version: 1,
  generatedAt: "2026-07-01T00:00:00Z",
  files: [{ path: "a/b.md", name: "n", size: 15, sha256: "s", mtime: 1 }],
};

const GOLDEN = {
  name: "__FILL__",
  blobHex: "__FILL__",
  manifestHex: "__FILL__",
};

describe("golden vectors (format lock)", () => {
  it("derived name is frozen", async () => {
    const { nameKey } = await deriveKeys(PASSPHRASE, SALT);
    expect(await deriveName(nameKey, "a/b.md")).toBe(GOLDEN.name);
  });

  it("blob bytes are frozen", async () => {
    const { contentKey } = await deriveKeys(PASSPHRASE, SALT);
    const blob = await encryptBlob(contentKey, PLAINTEXT, IV);
    expect(toHex(blob)).toBe(GOLDEN.blobHex);
  });

  it("manifest bytes are frozen", async () => {
    const { contentKey } = await deriveKeys(PASSPHRASE, SALT);
    const enc = await encryptManifest(MANIFEST, SALT, contentKey, IV);
    expect(toHex(enc)).toBe(GOLDEN.manifestHex);
  });
});
```

- [ ] **Step 2: Generate the actual golden values**

Run a one-off script (scratchpad, not committed) that imports the built functions with the same fixed inputs and prints `name`, `toHex(blob)`, `toHex(manifest)`. Command:

Run: `cd crypto-core && node --input-type=module -e "import('tsx').catch(()=>{})"` is not needed — instead use vitest to print by temporarily logging, OR write `crypto-core/test/_gen_golden.mjs` that dynamically imports via a tiny esbuild transform. Simplest: add a temporary `it` that `console.log`s the three values, run the file, copy output, delete the temp `it`.

Expected: three concrete strings (52-char name, hex blob, hex manifest).

- [ ] **Step 3: Fill the `GOLDEN` constants and verify**

Replace each `__FILL__` with the captured value.

Run: `cd crypto-core && npx vitest run test/golden.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 4: Sanity-check against spec**

Confirm blob starts `4f534431` (`OSD1`) + `01`, manifest starts `4f53444d` (`OSDM`) + `01` + salt hex `0102...10`. If not, the format is wrong — fix before freezing.

- [ ] **Step 5: Commit**

```bash
git add crypto-core/test/golden.test.ts
git commit -m "test(crypto-core): freeze golden vectors"
```

---

### Task 12: Full suite + typecheck green

**Files:** none (verification)

- [ ] **Step 1: Run all tests**

Run: `cd crypto-core && npm test`
Expected: PASS — all test files, ~26 tests.

- [ ] **Step 2: Typecheck**

Run: `cd crypto-core && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit any lockfile/config touch-ups if needed**

```bash
git add -A && git commit -m "chore(crypto-core): M0 green" || echo "nothing to commit"
```

---

## Self-review notes

- **Spec coverage:** §2.1–2.6 primitives (Task 5), blob format §2.3 (Task 7), manifest §2.4 (Task 9), names §2.5 (Task 6), sha256 §4 (Task 8), tests §10 round-trip/determinism/golden (Tasks 5–11). Cross-test §10 is implicitly covered — same code both sides; full cross-package e2e lands in M1/M2.
- **No Node/browser-specific APIs:** only `crypto.subtle`, `crypto.getRandomValues`, `TextEncoder`/`TextDecoder`, `Uint8Array` — all shared by Node 20 and iOS WebView.
- **Format lock:** HKDF empty salt + `content/v1`/`filename/v1` info, 200k iters, lowercase base32, header layouts — all pinned by Task 11.
- **Type consistency:** `DerivedKeys.contentKey/nameKey/salt`, `Manifest`/`ManifestFile` names used identically across keys/name/blob/manifest tasks.
