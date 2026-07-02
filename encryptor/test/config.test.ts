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

describe("loadConfig backends", () => {
  it("defaults backend to webdav", () => {
    expect(loadConfig({ fileJson: base, env: {} }).backend).toBe("webdav");
  });
  it("yandex backend requires a token, not webdav creds", () => {
    const yandexOk = {
      backend: "yandex",
      yandexToken: "tok",
      passphrase: "pw",
      sourceDir: "/v",
      statePath: "/s.json",
    };
    const cfg = loadConfig({ fileJson: yandexOk, env: {} });
    expect(cfg.backend).toBe("yandex");
    expect(cfg.yandexToken).toBe("tok");
  });
  it("yandex backend without token throws", () => {
    expect(() =>
      loadConfig({
        fileJson: { backend: "yandex", passphrase: "pw", sourceDir: "/v", statePath: "/s.json" },
        env: {},
      }),
    ).toThrow(/yandexToken/);
  });
  it("env YANDEX_TOKEN and REMOTE_BASE apply", () => {
    const cfg = loadConfig({
      fileJson: { backend: "yandex", passphrase: "pw", sourceDir: "/v", statePath: "/s.json" },
      env: { YANDEX_TOKEN: "envtok", REMOTE_BASE: "second-brain" },
    });
    expect(cfg.yandexToken).toBe("envtok");
    expect(cfg.remoteBase).toBe("second-brain");
  });
});
