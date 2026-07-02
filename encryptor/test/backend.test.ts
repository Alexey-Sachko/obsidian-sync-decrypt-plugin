import { describe, it, expect } from "vitest";
import { createBackend } from "../src/backend.js";
import { FetchWebDav } from "../src/webdav.js";
import { YandexWebDav } from "../src/yandex.js";
import type { EncryptorConfig } from "../src/types.js";

const base: EncryptorConfig = {
  backend: "webdav",
  webdavUrl: "http://x",
  webdavUser: "u",
  webdavPass: "p",
  yandexToken: "",
  remoteBase: "",
  passphrase: "pw",
  sourceDir: "/v",
  statePath: "/s.json",
  ignore: [],
};

describe("createBackend", () => {
  it("returns FetchWebDav for webdav", () => {
    expect(createBackend(base)).toBeInstanceOf(FetchWebDav);
  });
  it("returns YandexWebDav for yandex", () => {
    expect(createBackend({ ...base, backend: "yandex", yandexToken: "T" })).toBeInstanceOf(
      YandexWebDav,
    );
  });
});
