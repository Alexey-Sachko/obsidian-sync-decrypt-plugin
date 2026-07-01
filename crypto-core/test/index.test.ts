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
