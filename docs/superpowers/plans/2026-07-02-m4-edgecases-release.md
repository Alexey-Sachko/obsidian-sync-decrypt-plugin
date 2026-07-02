# M4 · Edge-cases + BRAT Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Harden the sync for real-world use — conditional manifest fetch (ETag/If-None-Match short-circuit), offline handling — and ship release tooling (GitHub Actions release workflow + README) so the plugin installs via BRAT and the encryptor deploys to a VPS.

**Architecture:** Same port-based, TDD-first approach. `WebDavClient` gains a `getConditional(name, etag?)` method returning `{ status, body?, etag? }`; `SyncEngine` uses it for the manifest and short-circuits on `304`, persisting the ETag. Offline is handled in the runtime (`main.ts`) via `navigator.onLine` plus a catch-time classification, surfaced through a new `StatusUI` "offline" phase (pure `statusText` addition, tested). Release tooling is committed config/docs (no actual release is created here).

**Tech Stack:** TypeScript 6, Obsidian API, Vitest, esbuild, GitHub Actions. Builds on M3.

## Deferred (documented, not built)

- **Atomic write (temp + rename):** SPEC §7 marks it optional; current behavior already self-heals (a partially written file's hash won't match next sync → re-downloaded). Skipped to avoid cross-platform rename risk; noted in README as future work.

## Locked decisions

- **Conditional manifest GET:** send `If-None-Match: <etag>` when a stored ETag exists. `304` → update `lastSync`, keep everything, return `{downloaded:0,failed:0,deleted:0,notModified:true}`. `200` → store the response `ETag` (case-insensitive header) in state for next time.
- **Blob GET stays unconditional** (`webdav.get`).
- **Offline:** before syncing, if `navigator.onLine === false` → set status "offline", skip. If a sync throws while `navigator.onLine === false` → classify as offline, not failed. Offline is not an error Notice spam; a single quiet status.
- **`SyncStats.notModified?`** optional so existing return sites/tests are unaffected (only the 304 path sets it).

## File structure

- `plugin/src/types.ts` — add `getConditional` to `WebDavClient`, `ConditionalGet`, `RequestResponse.headers?`, `SyncStats.notModified?` (modify).
- `plugin/src/status.ts` — add `"offline"` phase (modify).
- `plugin/src/webdav.ts` — implement `getConditional` (modify).
- `plugin/src/engine.ts` — conditional manifest + 304 short-circuit + ETag persist (modify).
- `plugin/src/main.ts` — offline guard + notModified Notice + ETag wiring (modify).
- `plugin/test/{status,webdav,engine}.test.ts` — updated/added tests.
- `.github/workflows/release.yml` — build + attach release assets on tag.
- `README.md` — project overview, build, encryptor deploy, BRAT install, security notes.

---

### Task 1: Offline status phase (`status.ts`)

**Files:**
- Modify: `plugin/src/status.ts`, `plugin/test/status.test.ts`

- [ ] **Step 1: Add failing tests** — in `plugin/test/status.test.ts`, inside `describe("statusText")`:

```ts
  it("offline", () => {
    expect(statusText({ kind: "offline" }, now)).toBe("Offline — will retry");
  });
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -w plugin -- status`
Expected: FAIL — `"offline"` not assignable / wrong text.

- [ ] **Step 3: Modify `plugin/src/status.ts`** — add to the union and switch:

```ts
export type SyncPhase =
  | { kind: "idle" }
  | { kind: "syncing"; done: number; total: number }
  | { kind: "synced"; lastSync: number }
  | { kind: "failed" }
  | { kind: "offline" };
```

Add the case before the closing brace of `statusText`'s switch:

```ts
    case "offline":
      return "Offline — will retry";
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -w plugin -- status`
Expected: PASS (9 tests).

- [ ] **Step 5: Add `setOffline` to `plugin/src/status-ui.ts`** (runtime; verified by build) — add method:

```ts
  setOffline(): void {
    this.phase = { kind: "offline" };
    this.render();
  }
```

- [ ] **Step 6: Commit**

```bash
git add plugin/src/status.ts plugin/src/status-ui.ts plugin/test/status.test.ts
git commit -m "feat(plugin): offline status phase"
```

---

### Task 2: Conditional manifest GET port + types (`types.ts`)

**Files:**
- Modify: `plugin/src/types.ts`

- [ ] **Step 1: Modify `plugin/src/types.ts`** — extend `WebDavClient`, add `ConditionalGet`, add `headers?` to `RequestResponse`, add `notModified?` to `SyncStats`.

Replace the `WebDavClient` interface with:

```ts
export interface ConditionalGet {
  status: number; // 200 or 304
  body?: Bytes;
  etag?: string;
}

export interface WebDavClient {
  /** GET remoteBase/name → raw bytes. Throws on network/HTTP failure. */
  get(name: string): Promise<Bytes>;
  /** Conditional GET; 304 → { status: 304 } (no body). */
  getConditional(name: string, etag?: string): Promise<ConditionalGet>;
}
```

In `SyncStats` add:

```ts
  notModified?: boolean;
```

In `RequestResponse` add:

```ts
  headers?: Record<string, string>;
```

- [ ] **Step 2: Typecheck (expected to surface downstream breaks)**

Run: `npm run typecheck -w plugin`
Expected: errors in `webdav.ts` (missing `getConditional`) and test fakes — fixed in Tasks 3–4. (This step just confirms the type change compiles in isolation once implementers catch up; proceed to Task 3.)

- [ ] **Step 3: Commit**

```bash
git add plugin/src/types.ts
git commit -m "feat(plugin): conditional-get port + etag/notModified types"
```

---

### Task 3: Adapter conditional GET (`webdav.ts`)

**Files:**
- Modify: `plugin/src/webdav.ts`, `plugin/test/webdav.test.ts`

- [ ] **Step 1: Add failing tests** — append to `plugin/test/webdav.test.ts` a new `describe`:

```ts
describe("ObsidianWebDavClient.getConditional", () => {
  it("sends If-None-Match and returns body + etag on 200", async () => {
    const calls: RequestArg[] = [];
    const fn = async (arg: RequestArg): Promise<RequestResponse> => {
      calls.push(arg);
      return {
        status: 200,
        arrayBuffer: new Uint8Array([7, 8]).buffer.slice(0) as ArrayBuffer,
        headers: { ETag: '"abc"' },
      };
    };
    const dav = new ObsidianWebDavClient({
      baseUrl: "http://x",
      remoteBase: "",
      user: "u",
      pass: "p",
      request: fn,
    });
    const res = await dav.getConditional("manifest.enc", '"old"');
    expect(calls[0]!.headers!["If-None-Match"]).toBe('"old"');
    expect(res.status).toBe(200);
    expect([...res.body!]).toEqual([7, 8]);
    expect(res.etag).toBe('"abc"');
  });

  it("returns 304 with no body", async () => {
    const fn = async (): Promise<RequestResponse> => ({
      status: 304,
      arrayBuffer: new ArrayBuffer(0),
    });
    const dav = new ObsidianWebDavClient({
      baseUrl: "http://x",
      remoteBase: "",
      user: "u",
      pass: "p",
      request: fn,
    });
    const res = await dav.getConditional("manifest.enc", '"old"');
    expect(res.status).toBe(304);
    expect(res.body).toBeUndefined();
  });

  it("omits If-None-Match when no etag given", async () => {
    const calls: RequestArg[] = [];
    const fn = async (arg: RequestArg): Promise<RequestResponse> => {
      calls.push(arg);
      return { status: 200, arrayBuffer: new ArrayBuffer(0), headers: {} };
    };
    const dav = new ObsidianWebDavClient({
      baseUrl: "http://x",
      remoteBase: "",
      user: "u",
      pass: "p",
      request: fn,
    });
    await dav.getConditional("manifest.enc");
    expect(calls[0]!.headers!["If-None-Match"]).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -w plugin -- webdav`
Expected: FAIL — `getConditional` is not a function.

- [ ] **Step 3: Modify `plugin/src/webdav.ts`** — import `ConditionalGet`, add the method:

```ts
import type { Bytes, ConditionalGet, RequestFn, WebDavClient } from "./types.js";
```

Add inside the class:

```ts
  async getConditional(name: string, etag?: string): Promise<ConditionalGet> {
    const headers: Record<string, string> = { Authorization: this.auth };
    if (etag) headers["If-None-Match"] = etag;
    const res = await this.request({
      url: `${this.base}/${name}`,
      method: "GET",
      headers,
      throw: false,
    });
    if (res.status === 304) return { status: 304 };
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`GET ${name} failed: ${res.status}`);
    }
    const respEtag = res.headers?.["ETag"] ?? res.headers?.["etag"];
    return { status: 200, body: new Uint8Array(res.arrayBuffer), etag: respEtag };
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -w plugin -- webdav`
Expected: PASS (6 tests: 3 old + 3 new).

- [ ] **Step 5: Commit**

```bash
git add plugin/src/webdav.ts plugin/test/webdav.test.ts
git commit -m "feat(plugin): conditional (If-None-Match) manifest GET"
```

---

### Task 4: Engine ETag short-circuit (`engine.ts`)

**Files:**
- Modify: `plugin/src/engine.ts`, `plugin/test/engine.test.ts`

- [ ] **Step 1: Update the test FakeDav + add tests** — in `plugin/test/engine.test.ts`:

Replace the `FakeDav` class with an ETag-aware version:

```ts
class FakeDav implements WebDavClient {
  gets: string[] = [];
  conditionalCalls: Array<string | undefined> = [];
  constructor(
    public blobs: Map<string, Bytes>,
    public failNames = new Set<string>(),
    public etag = '"v1"',
  ) {}
  async get(name: string): Promise<Bytes> {
    this.gets.push(name);
    if (this.failNames.has(name)) throw new Error(`boom ${name}`);
    const b = this.blobs.get(name);
    if (!b) throw new Error(`404 ${name}`);
    return b;
  }
  async getConditional(name: string, etag?: string) {
    this.conditionalCalls.push(etag);
    if (etag && etag === this.etag) return { status: 304 as const };
    const body = this.blobs.get(name);
    if (!body) throw new Error(`404 ${name}`);
    return { status: 200, body, etag: this.etag };
  }
}
```

Add two tests inside `describe("SyncEngine.run")`:

```ts
  it("stores the manifest etag and short-circuits on 304", async () => {
    const remote = await buildRemote({ "a.md": "alpha" });
    const dav = new FakeDav(remote);
    const state = new FakeState(emptyState());
    const r1 = await new SyncEngine({ webdav: dav, vault: new FakeVault(), state, settings: settings() }).run();
    expect(r1.notModified).toBeFalsy();
    expect(state.get().manifestEtag).toBe('"v1"');

    const dav2 = new FakeDav(remote); // same etag "v1"
    const vault2 = new FakeVault();
    const r2 = await new SyncEngine({ webdav: dav2, vault: vault2, state, settings: settings() }).run();
    expect(r2.notModified).toBe(true);
    expect(r2).toMatchObject({ downloaded: 0, failed: 0, deleted: 0 });
    expect(dav2.conditionalCalls).toEqual(['"v1"']);
    expect(vault2.written.size).toBe(0);
  });

  it("re-syncs when the etag changed", async () => {
    const remote1 = await buildRemote({ "a.md": "alpha" });
    const state = new FakeState(emptyState());
    await new SyncEngine({ webdav: new FakeDav(remote1, new Set(), '"v1"'), vault: new FakeVault(), state, settings: settings() }).run();

    const remote2 = await buildRemote({ "a.md": "alpha EDITED" });
    const dav2 = new FakeDav(remote2, new Set(), '"v2"');
    const vault2 = new FakeVault();
    const r2 = await new SyncEngine({ webdav: dav2, vault: vault2, state, settings: settings() }).run();
    expect(r2.notModified).toBeFalsy();
    expect(vault2.written.get("a.md")).toBe("alpha EDITED");
    expect(state.get().manifestEtag).toBe('"v2"');
  });
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -w plugin -- engine`
Expected: FAIL — engine still calls `get("manifest.enc")` / doesn't set `notModified`/`manifestEtag`.

- [ ] **Step 3: Modify `plugin/src/engine.ts`** — replace the manifest fetch section. Change:

```ts
    // Fetch + decrypt manifest first; wrong passphrase throws here, before any write.
    const manifestBytes = await webdav.get(MANIFEST_NAME);
    const salt = readManifestSalt(manifestBytes);
```

to:

```ts
    // Conditional manifest fetch: 304 means nothing changed since last sync.
    const manifestRes = await webdav.getConditional(MANIFEST_NAME, current.manifestEtag);
    if (manifestRes.status === 304) {
      current.lastSync = Date.now();
      state.set(current);
      await state.save();
      return { downloaded: 0, failed: 0, deleted: 0, notModified: true };
    }
    const manifestBytes = manifestRes.body!;
    const salt = readManifestSalt(manifestBytes);
```

Note the `current` must be read before this block. Move `const current = state.get();` to just above the manifest fetch. Then after decrypting and before the download loop, keep using `current`. Finally, where `current.lastSync = Date.now();` is set at the end, also persist the etag:

```ts
    current.lastSync = Date.now();
    current.manifestEtag = manifestRes.etag;
    state.set(current);
    await state.save();
```

(Remove the now-duplicate earlier `const current = state.get();` further down if present — there must be exactly one.)

- [ ] **Step 4: Run to verify pass**

Run: `npm test -w plugin -- engine`
Expected: PASS (all engine tests incl. the two new).

- [ ] **Step 5: Commit**

```bash
git add plugin/src/engine.ts plugin/test/engine.test.ts
git commit -m "feat(plugin): manifest ETag short-circuit in SyncEngine"
```

---

### Task 5: Runtime offline guard + notModified Notice (`main.ts`)

**Files:**
- Modify: `plugin/src/main.ts`

Runtime — verified by typecheck + build.

- [ ] **Step 1: Modify `syncNow()` in `plugin/src/main.ts`** — add an offline pre-check and classify catch-time offline; show a distinct Notice on `notModified`.

Replace the body of `syncNow()` with:

```ts
  async syncNow(): Promise<void> {
    if (this.syncing) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      this.status.setOffline();
      return;
    }
    this.syncing = true;
    try {
      const webdav = new ObsidianWebDavClient({
        baseUrl: this.settings.webdavUrl,
        remoteBase: this.settings.remoteBase,
        user: this.settings.webdavUser,
        pass: this.settings.webdavPass,
        request: this.makeRequest(),
      });
      const vault = new ObsidianVaultWriter(this.app.vault.adapter);
      const store = new PluginStateStore(this.state, async (st) => {
        this.state = st;
        await this.persist();
      });
      const engine = new SyncEngine({
        webdav,
        vault,
        state: store,
        settings: this.settings,
        onProgress: (done, total) => this.status.setSyncing(done, total),
      });

      this.status.setSyncing(0, 0);
      const stats = await engine.run();
      this.status.setSynced(this.state.lastSync ?? Date.now());
      if (stats.notModified) {
        new Notice("Already up to date");
      } else {
        new Notice(`Synced ${stats.downloaded}, failed ${stats.failed}, deleted ${stats.deleted}`);
      }
    } catch (err) {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        this.status.setOffline();
      } else {
        this.status.setFailed();
        new Notice(`Sync failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      this.syncing = false;
    }
  }
```

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck -w plugin && npm run build -w plugin`
Expected: no errors; "Built main.js".

- [ ] **Step 3: Commit**

```bash
git add plugin/src/main.ts
git commit -m "feat(plugin): offline guard + up-to-date notice"
```

---

### Task 6: Release tooling (workflow + README)

**Files:**
- Create: `.github/workflows/release.yml`, `README.md`

- [ ] **Step 1: Write `.github/workflows/release.yml`**

```yaml
name: Release plugin

on:
  push:
    tags:
      - "*"

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm ci
      - run: npm run build -w plugin
      - name: Create release with plugin assets
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          gh release create "${{ github.ref_name }}" \
            plugin/main.js plugin/manifest.json plugin/styles.css plugin/versions.json \
            --title "${{ github.ref_name }}" \
            --generate-notes
```

- [ ] **Step 2: Write `README.md`** (repo root) — overview, architecture, build/test commands, encryptor deploy, BRAT install, security notes, iOS caveats, deferred items.

```markdown
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

Keep `state.json` — it holds the one-time salt; losing it changes every remote name.

## Plugin (install via BRAT)

1. Install the **BRAT** community plugin in Obsidian.
2. BRAT → *Add beta plugin* → this repo's URL.
3. Enable **WebDAV Decrypt Sync**, open its settings, fill in the WebDAV URL / credentials
   and the **same passphrase** as the encryptor, then **Test connection**.
4. Use **Sync now** (ribbon / command) or set a sync interval and *sync on open*.

**iOS:** there is no background sync — syncing runs only while Obsidian is in the
foreground (on open, on the chosen interval, or manually). The local vault is
treated read-only; local edits are overwritten on the next sync.

## Security notes

- `passphrase` is stored in the plugin's `data.json` (accepted tradeoff). AES-256-GCM
  content, PBKDF2 (200k) → HKDF; remote names are HMAC-based and opaque.
- A wrong passphrase fails the manifest's GCM tag → sync aborts before any write.

## Deferred / future

- Atomic writes (temp + rename) — current self-healing (hash mismatch re-downloads) is sufficient for v1.
- Android, streaming encryption for large attachments, keyfile instead of passphrase.
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml README.md
git commit -m "docs: release workflow + README (BRAT + encryptor deploy)"
```

---

### Task 7: Full suite + typecheck + build + docs

- [ ] **Step 1: Run everything**

Run: `npm test && npm run typecheck && npm run build -w plugin && npm run build -w encryptor`
Expected: all tests pass; typechecks clean; both bundles build.

- [ ] **Step 2: Update `CLAUDE.md`** — mark M4 done (ETag short-circuit, offline, release tooling); note atomic-write deferred; note release is via git tag → GitHub Actions.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: mark M4 (edge-cases + release tooling) done"
```

---

## Self-review notes

- **Spec coverage §7/§9/§11:** offline status + retry (Tasks 1,5), ETag/If-None-Match short-circuit §3.2/§6.2 (Tasks 2–4), BRAT release assets + `versions.json` §9 (Task 6). Wrong-passphrase/per-file-error/guard already covered in M2. Atomic write explicitly deferred with rationale.
- **Testability:** offline text, conditional GET, and ETag short-circuit are all unit-tested; only the `main.ts` offline glue is runtime (typecheck + build).
- **Backward compatibility:** `SyncStats.notModified` and `WebDavClient.getConditional` are additive; `get` remains for blobs and `testConnection`. Existing engine tests updated for the new FakeDav.
- **Type consistency:** `ConditionalGet`, `RequestResponse.headers`, `SyncStats.notModified`, `SyncPhase "offline"` defined once and reused.
