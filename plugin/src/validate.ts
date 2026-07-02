import type { PluginSettings, WebDavClient } from "./types.js";

export function validateSettings(s: PluginSettings): string[] {
  const errors: string[] = [];
  if (s.backend === "yandex") {
    if (!s.yandexToken.trim()) errors.push("Yandex.Disk token is required");
  } else {
    if (!s.webdavUrl.trim()) errors.push("WebDAV URL is required");
  }
  if (!s.passphrase) errors.push("Passphrase is required");
  return errors;
}

export type ConnectionResult = { ok: true } | { ok: false; message: string };

export async function testConnection(webdav: WebDavClient): Promise<ConnectionResult> {
  try {
    await webdav.get("manifest.enc");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
