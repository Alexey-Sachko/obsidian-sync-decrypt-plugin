import { FetchWebDav } from "./webdav.js";
import { YandexWebDav } from "./yandex.js";
import type { EncryptorConfig, WebDav } from "./types.js";

export function createBackend(config: EncryptorConfig): WebDav {
  if (config.backend === "yandex") {
    return new YandexWebDav({ token: config.yandexToken, remoteBase: config.remoteBase });
  }
  return new FetchWebDav({
    baseUrl: config.webdavUrl,
    user: config.webdavUser,
    pass: config.webdavPass,
  });
}
