import type { EncryptorConfig } from "./types.js";

const DEFAULT_IGNORE = [".obsidian", ".trash", ".git"];

type PartialConfig = Partial<Record<keyof EncryptorConfig, unknown>>;

const ENV_MAP: Record<string, keyof EncryptorConfig> = {
  WEBDAV_URL: "webdavUrl",
  WEBDAV_USER: "webdavUser",
  WEBDAV_PASS: "webdavPass",
  PASSPHRASE: "passphrase",
  SOURCE_DIR: "sourceDir",
  STATE_PATH: "statePath",
};

const REQUIRED: (keyof EncryptorConfig)[] = [
  "webdavUrl",
  "webdavUser",
  "webdavPass",
  "passphrase",
  "sourceDir",
  "statePath",
];

export function loadConfig(opts: {
  fileJson?: PartialConfig;
  env: Record<string, string | undefined>;
}): EncryptorConfig {
  const merged: PartialConfig = { ...(opts.fileJson ?? {}) };
  for (const [envKey, cfgKey] of Object.entries(ENV_MAP)) {
    const v = opts.env[envKey];
    if (v !== undefined && v !== "") merged[cfgKey] = v;
  }

  const missing = REQUIRED.filter((k) => typeof merged[k] !== "string" || merged[k] === "");
  if (missing.length) throw new Error(`Missing required config: ${missing.join(", ")}`);

  const ignore = Array.isArray(merged.ignore) ? (merged.ignore as string[]) : DEFAULT_IGNORE;

  return {
    webdavUrl: merged.webdavUrl as string,
    webdavUser: merged.webdavUser as string,
    webdavPass: merged.webdavPass as string,
    passphrase: merged.passphrase as string,
    sourceDir: merged.sourceDir as string,
    statePath: merged.statePath as string,
    ignore,
  };
}
