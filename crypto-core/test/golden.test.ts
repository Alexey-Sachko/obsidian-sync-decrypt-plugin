import { describe, it, expect } from "vitest";
import { deriveKeys } from "../src/keys.js";
import { deriveName } from "../src/name.js";
import { encryptBlob } from "../src/blob.js";
import { encryptManifest } from "../src/manifest.js";
import { toHex, utf8Encode } from "../src/bytes.js";
import type { Manifest } from "../src/types.js";

// Fixed inputs — DO NOT CHANGE without a format version bump (see SPEC §2).
const PASSPHRASE = "golden-passphrase";
const SALT = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
const IV = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
const PLAINTEXT = utf8Encode("golden content\n");
const MANIFEST: Manifest = {
  version: 1,
  generatedAt: "2026-07-01T00:00:00Z",
  files: [{ path: "a/b.md", name: "n", size: 15, sha256: "s", mtime: 1 }],
};

// Frozen outputs. A change here means the on-disk format shifted and CLI/plugin
// compatibility is broken — bump the format version deliberately, do not "fix" these.
const GOLDEN = {
  name: "rmfs2f56p7nmcvhvruppuxttdlm6rrhoapl7wlwmnxxzede2ioua",
  blobHex:
    "4f53443101000102030405060708090a0ba4fa3b45b5efec2f25592c7f24a4071bb2b454f2e2fbc9d5c53bc5801c1b8e",
  manifestHex:
    "4f53444d010102030405060708090a0b0c0d0e0f10000102030405060708090a0bb8b72144a2f2a5232415622b66f26a4c19e4734de86969d7ee10dcfb91c546a9601b7da9e4ef8a78e337dc73a25580a1cd5e4f79d5db955e2cb71eb9a39a057dfedac903c657ff2669859026aec84da16fecf9b922d2745d038595f110babb8aaded24445ffa7d02958183bbb50ad9feaf31fd8b9ad5704f825fe43f99785fa9cfa311c6a5724d25c7f6",
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
