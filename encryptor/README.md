# encryptor — operator reference

Precise reference for running the `encryptor` CLI (intended for an automated operator / AI agent).
It encrypts a local Obsidian vault and syncs the encrypted blobs + `manifest.enc` to a remote
(**WebDAV** or **Yandex.Disk REST**). It is **one-way and read-from-source only**: it never modifies
`sourceDir`; it only writes to the remote.

## 1. Prerequisites

- **Node.js ≥ 20** on PATH (`node --version`).
- The single bundled file **`encryptor.mjs`** (no `node_modules`, no `npm install` needed).
  Build it from the repo with `npm run build -w encryptor` → `encryptor/encryptor.mjs`, then copy that
  one file wherever you run it.

## 2. Invocation

```
node encryptor.mjs [--config <path>] [--full] [--help]
```

| Flag | Meaning |
|------|---------|
| `--config <path>` | Path to the JSON config. Default `config.json`. Resolved **relative to the current working directory** unless absolute. |
| `--full` | Re-encrypt and re-upload **every** file, ignoring saved state. Use after changing the passphrase, or to force a full resync. |
| `--help`, `-h` | Print usage and exit 0. Does nothing else. |

Unknown arguments are ignored. Order does not matter.

### Working directory
The command reads/writes these paths; each is used **as given** (absolute, or relative to the process
CWD): `--config`, `sourceDir`, `statePath`. **Recommendation for agents: always pass absolute paths**
(config keys and `--config`) so behavior is independent of CWD.

## 3. Configuration

Config comes from two sources, merged in this order (later wins):
1. the JSON file at `--config` (if it exists; a missing file is not an error as long as env supplies the required keys),
2. environment variables.

### 3.1 Keys

| Key | Type | Env override | Required | Default |
|-----|------|--------------|----------|---------|
| `backend` | `"webdav"` \| `"yandex"` | `BACKEND` | no | `"webdav"` |
| `passphrase` | string | `PASSPHRASE` | **yes** | — |
| `sourceDir` | string (path) | `SOURCE_DIR` | **yes** | — |
| `statePath` | string (path) | `STATE_PATH` | **yes** | — |
| `ignore` | string[] | — (file only) | no | `[".obsidian", ".trash", ".git"]` |
| `webdavUrl` | string (URL, incl. remote subfolder) | `WEBDAV_URL` | yes if `backend=webdav` | `""` |
| `webdavUser` | string | `WEBDAV_USER` | yes if `backend=webdav` | `""` |
| `webdavPass` | string | `WEBDAV_PASS` | yes if `backend=webdav` | `""` |
| `yandexToken` | string (OAuth token) | `YANDEX_TOKEN` | yes if `backend=yandex` | `""` |
| `remoteBase` | string (Disk folder) | `REMOTE_BASE` | no | `""` |

Missing required keys → the process prints `encryptor: Missing required config: <keys>` to stderr and exits `1`.

### 3.2 `sourceDir` — the folder to encrypt
Absolute path to the **plaintext** vault root. The tool walks it recursively. Only this folder is read;
it is never written to.

### 3.3 Destination (where blobs go)
- **webdav**: put the full destination URL **including the target subfolder** in `webdavUrl`,
  e.g. `https://host/webdav/second-brain`. The folder **must already exist** on the server
  (the WebDAV backend does not create it). Blobs are written flat inside it.
- **yandex**: `remoteBase` is the Disk folder name, e.g. `second-brain` → files land at
  `disk:/second-brain/<name>`. The folder is **auto-created** if missing. Leave `remoteBase` empty to use
  the Disk root.

### 3.4 `ignore` — what to skip
An array of **exact names** (not globs, not paths). A directory or file is skipped if its own name
matches any entry, **at any depth**. Examples:
- `".obsidian"` skips every folder/file named `.obsidian` anywhere in the tree.
- `"attachments"` would skip **all** folders named `attachments` at any level.
- You cannot target a specific path like `Notes/attachments` — matching is by name only.

If you set `ignore`, it **replaces** the default list — include `.obsidian` etc. yourself if you still want them ignored.

## 4. Behavior (deterministic)

On each run:
1. Load `statePath` (or initialize it, generating a one-time random salt) — see §6.
2. Derive keys from `passphrase` + salt (once).
3. Walk `sourceDir`, skipping ignored names.
4. For each file: compute `sha256(plaintext)`. If it matches the saved state and `--full` is not set →
   **skip** (no upload). Otherwise encrypt and upload the blob under an opaque deterministic name.
5. Files present in state but no longer in `sourceDir` → **delete** their remote blob.
6. Rebuild `manifest.enc` (the list of all current files) and upload it.
7. Write the updated `statePath`.

Re-running with no source changes uploads nothing except a refreshed `manifest.enc`. Safe to run on a schedule.

## 5. Output contract

- **Success:** exit code `0`, and exactly one line on **stdout**:
  ```
  Synced: uploaded N, skipped M, deleted K
  ```
  (`N`/`M`/`K` are integers.) Parse this line to get counts.
- **Failure:** exit code `1`, and one line on **stderr**:
  ```
  encryptor: <message>
  ```
  Common messages: `Missing required config: …`, HTTP failures like `PUT <name> failed: 403`,
  `upload href <name> failed: <status>`, folder/network errors. On failure, `statePath` is not updated
  (safe to retry).
- `--help` prints usage to stdout, exit `0`.

## 6. State file (`statePath`)

JSON: `{ "salt": "<base64>", "files": { "<relPath>": { "sha256", "name", "mtime" } } }`.
- Holds the **one-time salt** and the change-detection map. **Do not delete or edit it.**
- Deleting it → a new salt is generated → all remote names change → the next run re-uploads everything
  (old blobs become orphaned). Only do this intentionally (e.g. rotating the passphrase, together with `--full`).
- Keep one `statePath` per (vault, remote) pair.

## 7. Constraints & invariants

- `passphrase` **must be identical** to the one configured in the Obsidian plugin, or decryption on the
  device fails.
- Secrets (`passphrase`, `webdavPass`, `yandexToken`) should be passed via **env vars**, not committed to
  a config file in a repo.
- Yandex OAuth tokens last ~1 year; when expired, calls fail with HTTP 401 — obtain a new token.
- Yandex REST does 2 HTTP requests per file (get presigned href, then transfer); expect more round-trips
  than WebDAV.

## 8. Examples

### WebDAV, config file (absolute paths)
`/opt/encryptor/config.json`:
```json
{
  "backend": "webdav",
  "webdavUrl": "https://dav.example.com/webdav/second-brain",
  "webdavUser": "alexey",
  "webdavPass": "…",
  "passphrase": "…",
  "sourceDir": "/home/alexey/vault",
  "statePath": "/opt/encryptor/state.json"
}
```
```bash
node /opt/encryptor/encryptor.mjs --config /opt/encryptor/config.json
```

### Yandex.Disk, secrets from env (config file has only non-secrets)
`/opt/encryptor/config.json`:
```json
{ "backend": "yandex", "remoteBase": "second-brain",
  "sourceDir": "/home/alexey/vault", "statePath": "/opt/encryptor/state.json" }
```
```bash
PASSPHRASE='…' YANDEX_TOKEN='…' node /opt/encryptor/encryptor.mjs --config /opt/encryptor/config.json
```

### Force a full resync
```bash
node /opt/encryptor/encryptor.mjs --config /opt/encryptor/config.json --full
```

### Scheduled run (systemd timer, every 15 min) — sketch
`encryptor.service`:
```ini
[Service]
Type=oneshot
WorkingDirectory=/opt/encryptor
Environment=PASSPHRASE=… YANDEX_TOKEN=…
ExecStart=/usr/bin/node /opt/encryptor/encryptor.mjs --config /opt/encryptor/config.json
```
`encryptor.timer`: `OnUnitActiveSec=15min` + `[Install] WantedBy=timers.target`.

## 9. Quick agent checklist

1. Ensure `node --version` ≥ 20 and `encryptor.mjs` is present.
2. Write/verify config with absolute `sourceDir` and `statePath`; pick `backend`; supply the backend's
   credentials (prefer env for secrets).
3. For `backend=webdav`, ensure the destination folder in `webdavUrl` exists on the server.
4. Run `node encryptor.mjs --config <abs path>`.
5. Exit `0` + parse `Synced: uploaded N, skipped M, deleted K`. Exit `1` → read the stderr `encryptor: …`
   message; state is unchanged, safe to fix and retry.
6. Do not touch `statePath` between runs.
