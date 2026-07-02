import { readFile, writeFile } from "node:fs/promises";
import { loadConfig } from "./config.js";
import { newState, parseState, serializeState } from "./state.js";
import { NodeSourceFs } from "./walk.js";
import { createBackend } from "./backend.js";
import { encryptSync } from "./sync.js";
import type { SyncState } from "./types.js";

export interface CliArgs {
  configPath: string;
  full: boolean;
  help: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { configPath: "config.json", full: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--full") args.full = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--config") args.configPath = argv[++i] ?? args.configPath;
  }
  return args;
}

const HELP = `encryptor — encrypt an Obsidian vault and sync it to a remote (WebDAV or Yandex.Disk)

Usage: node encryptor.mjs [--config <path>] [--full] [--help]

  --config <path>  Path to config.json (default: ./config.json, relative to CWD)
  --full           Re-encrypt and re-upload every file, ignoring saved state
  --help, -h       Show this help

Config (config.json; any key can be overridden by the env var in parentheses):
  backend      "webdav" | "yandex"        (BACKEND)      default "webdav"
  passphrase   decryption passphrase       (PASSPHRASE)   required
  sourceDir    path to the plaintext vault (SOURCE_DIR)   required
  statePath    path to state.json          (STATE_PATH)   required
  ignore       array of names to skip (dirs/files, any depth)  default [".obsidian",".trash",".git"]
  webdav ->    webdavUrl (WEBDAV_URL), webdavUser (WEBDAV_USER), webdavPass (WEBDAV_PASS)
  yandex ->    yandexToken (YANDEX_TOKEN), remoteBase (REMOTE_BASE)

Exit: 0 = ok, 1 = error (message on stderr). On success prints to stdout:
  Synced: uploaded N, skipped M, deleted K
`;

async function readJsonIfPresent(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
}

async function loadState(statePath: string): Promise<SyncState> {
  try {
    return parseState(await readFile(statePath, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return newState();
    throw e;
  }
}

export async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }

  const fileJson = await readJsonIfPresent(args.configPath);
  const config = loadConfig({ fileJson, env: process.env });

  const state = await loadState(config.statePath);
  const source = new NodeSourceFs(config.sourceDir, config.ignore);
  const webdav = createBackend(config);

  const { state: nextState, stats } = await encryptSync({
    source,
    webdav,
    passphrase: config.passphrase,
    state,
    full: args.full,
  });

  await writeFile(config.statePath, serializeState(nextState));
  process.stdout.write(
    `Synced: uploaded ${stats.uploaded}, skipped ${stats.skipped}, deleted ${stats.deleted}\n`,
  );
}
