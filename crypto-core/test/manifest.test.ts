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
