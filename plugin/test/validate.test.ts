import { describe, it, expect } from "vitest";
import { validateSettings, testConnection } from "../src/validate.js";
import type { PluginSettings, WebDavClient } from "../src/types.js";
import type { Bytes } from "crypto-core";

const ok: PluginSettings = {
  webdavUrl: "https://x",
  webdavUser: "u",
  webdavPass: "p",
  passphrase: "pw",
  remoteBase: "",
  targetFolder: "",
  deleteMissing: true,
  syncInterval: 0,
  syncOnOpen: true,
};

describe("validateSettings", () => {
  it("no errors for a complete config", () => {
    expect(validateSettings(ok)).toEqual([]);
  });
  it("flags empty URL and passphrase", () => {
    const errs = validateSettings({ ...ok, webdavUrl: "", passphrase: "" });
    expect(errs).toContain("WebDAV URL is required");
    expect(errs).toContain("Passphrase is required");
  });
});

describe("testConnection", () => {
  it("ok when manifest fetch resolves", async () => {
    const dav: WebDavClient = {
      get: async () => new Uint8Array([1]) as Bytes,
      getConditional: async () => ({ status: 200, body: new Uint8Array([1]) as Bytes }),
    };
    expect(await testConnection(dav)).toEqual({ ok: true });
  });
  it("returns the error message on failure", async () => {
    const dav: WebDavClient = {
      get: async () => {
        throw new Error("GET manifest.enc failed: 401");
      },
      getConditional: async () => {
        throw new Error("GET manifest.enc failed: 401");
      },
    };
    const res = await testConnection(dav);
    expect(res.ok).toBe(false);
    expect(res.ok ? "" : res.message).toMatch(/401/);
  });
});
