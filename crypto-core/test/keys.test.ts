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
