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

  it("fails auth with wrong key (tampered / wrong passphrase)", async () => {
    const a = await deriveKeys("pw1", salt);
    const b = await deriveKeys("pw2", salt);
    const blob = await encryptBlob(a.contentKey, new Uint8Array([1, 2, 3]));
    await expect(decryptBlob(b.contentKey, blob)).rejects.toThrow();
  });
});
