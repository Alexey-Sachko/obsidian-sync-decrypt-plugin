# Obsidian WebDAV Decrypt Sync

One-way sync of an **encrypted** Obsidian vault from WebDAV, **decrypted on-device**
(iOS-capable). Encryption happens on a VPS via a zero-dependency CLI; the plugin only
ever reads: it downloads, decrypts, and writes plaintext into the local vault.

- `crypto-core/` — shared Web-Crypto format (keys, blob, manifest, names). Same bytes on both sides.
- `encryptor/` — Node ≥ 20 CLI. Incrementally encrypts a vault and PUT/DELETEs blobs + `manifest.enc` to WebDAV. Ships as one file.
- `plugin/` — the Obsidian plugin (`SyncEngine`, WebDAV via `requestUrl`, scheduler, settings, status).

See [SPEC.md](SPEC.md) for the byte format and protocol.

## Build & test

```bash
npm install                      # workspaces
npm test                         # all packages
npm run build -w encryptor       # → encryptor/encryptor.mjs (single file)
npm run build -w plugin          # → plugin/main.js
```

Local end-to-end against a real WebDAV: `docker compose up -d` (see [docker-compose.yml](docker-compose.yml)).

## Encryptor (VPS)

> Full operator reference (flags, config keys, env vars, paths, ignore rules, output/exit-code
> contract) — for humans or an automated agent: **[encryptor/README.md](encryptor/README.md)**.

1. `npm run build -w encryptor`, copy `encryptor/encryptor.mjs` to the server.
2. Create `config.json`:
   ```json
   {
     "webdavUrl": "https://dav.example.com/vault",
     "webdavUser": "user",
     "webdavPass": "pass",
     "passphrase": "your-long-passphrase",
     "sourceDir": "/path/to/vault",
     "statePath": "/path/to/state.json"
   }
   ```
   (Any key can be overridden by env: `WEBDAV_URL`, `WEBDAV_USER`, `WEBDAV_PASS`, `PASSPHRASE`, `SOURCE_DIR`, `STATE_PATH`.)
3. Run `node encryptor.mjs` (add `--full` to re-encrypt everything). Schedule with cron/systemd.

Keep `state.json` — it holds the one-time salt; losing it changes every remote name and forces a full re-upload.

## Plugin (install via BRAT)

1. Install the **BRAT** community plugin in Obsidian.
2. BRAT → *Add beta plugin* → this repo's URL.
3. Enable **WebDAV Decrypt Sync**, open its settings, fill in the WebDAV URL / credentials
   and the **same passphrase** as the encryptor, then **Test connection**.
4. Use **Sync now** (ribbon / command) or set a sync interval and *sync on open*.

**iOS:** there is no background sync — syncing runs only while Obsidian is in the
foreground (on open, on the chosen interval, or manually). The local vault is
treated read-only; local edits are overwritten on the next sync.

## Yandex.Disk backend (alternative to WebDAV)

Yandex.Disk blocks WebDAV writes on the free tier (HTTP 402), but its **REST API works**.
Both the encryptor and the plugin support `backend: "yandex"`.

1. Register an OAuth app at `https://oauth.yandex.ru/` — choose **"For API access"**, add scopes
   `cloud_api:disk.read` + `cloud_api:disk.write`, redirect URI `https://oauth.yandex.ru/verification_code`.
2. Get a token in the browser (implicit flow):
   `https://oauth.yandex.ru/authorize?response_type=token&client_id=<CLIENT_ID>` → copy `access_token` from the URL.
3. **Encryptor** `config.json`:
   ```json
   { "backend": "yandex", "yandexToken": "<token>", "remoteBase": "second-brain",
     "passphrase": "…", "sourceDir": "/path/to/vault", "statePath": "/path/to/state.json" }
   ```
   (env overrides: `BACKEND`, `YANDEX_TOKEN`, `REMOTE_BASE`.)
4. **Plugin** settings: Backend → *Yandex.Disk*, paste the OAuth token, set *Remote base* to the Disk folder.

Files live at `disk:/<remoteBase>/<name>`. Tokens last ~1 year; refresh by repeating step 2 (headless
`--login` device-flow is planned). Note: Yandex REST does two requests per file (get presigned href, then transfer).

## Releasing (for BRAT)

Tag a version matching `plugin/manifest.json` and push it; the
[release workflow](.github/workflows/release.yml) builds and attaches
`main.js`, `manifest.json`, `styles.css`, `versions.json` to the GitHub release.

```bash
git tag 0.1.0 && git push origin 0.1.0
```

## Security notes

- `passphrase` is stored in the plugin's `data.json` (accepted tradeoff). Content is
  AES-256-GCM with PBKDF2 (200k) → HKDF; remote names are HMAC-based and opaque.
- A wrong passphrase fails the manifest's GCM tag → sync aborts before any write.

## Deferred / future

- Atomic writes (temp + rename) — current self-healing (a partial file's hash won't
  match next sync → it re-downloads) is sufficient for v1.
- Android, streaming encryption for large attachments, keyfile instead of passphrase.
