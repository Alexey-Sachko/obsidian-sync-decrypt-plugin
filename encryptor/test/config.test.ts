import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

const base = {
  webdavUrl: "https://x",
  webdavUser: "u",
  webdavPass: "p",
  passphrase: "pw",
  sourceDir: "/vault",
  statePath: "/state.json",
};

describe("loadConfig", () => {
  it("accepts a complete file config and defaults ignore", () => {
    const cfg = loadConfig({ fileJson: base, env: {} });
    expect(cfg.webdavUrl).toBe("https://x");
    expect(cfg.ignore).toEqual([".obsidian", ".trash", ".git"]);
  });

  it("env overrides file", () => {
    const cfg = loadConfig({ fileJson: base, env: { WEBDAV_URL: "https://y", PASSPHRASE: "z" } });
    expect(cfg.webdavUrl).toBe("https://y");
    expect(cfg.passphrase).toBe("z");
  });

  it("throws listing all missing required fields", () => {
    expect(() => loadConfig({ fileJson: {}, env: {} })).toThrow(/passphrase/);
  });
});
