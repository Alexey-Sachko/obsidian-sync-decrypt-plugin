# M5 · Yandex.Disk REST Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add Yandex.Disk REST API as a second storage backend (alongside WebDAV) in both the encryptor and the plugin, selectable via config/settings — so an encrypted vault can live on Yandex.Disk (whose free tier blocks WebDAV writes but allows REST).

**Architecture:** The existing ports (`WebDav` in encryptor, `WebDavClient` in plugin) already abstract the remote store. Add second implementations (`YandexWebDav`, `YandexClient`) and a small factory selected by `backend: "webdav" | "yandex"`. Crypto, manifest, diff, `encryptSync`, and `SyncEngine` are untouched. Yandex specifics: `Authorization: OAuth <token>`; two-step transfer (get presigned `href`, then PUT/GET it); paths are `disk:/<remoteBase>/<name>`; "not modified" uses the manifest's `md5` from the metadata endpoint instead of an HTTP ETag.

**Tech Stack:** TypeScript 6, Node global `fetch` (encryptor), Obsidian `requestUrl` (plugin), crypto-core, Vitest, esbuild. Builds on M4.

## Yandex REST reference (verified working on free tier)

- Base: `https://cloud-api.yandex.net/v1/disk`. Auth header `Authorization: OAuth <token>`.
- **Upload:** `GET /resources/upload?path=<diskPath>&overwrite=true` → `{href}` → `PUT <href>` (body; href is presigned, no auth) → 201.
- **Download:** `GET /resources/download?path=<diskPath>` → `{href}` → `GET <href>` → bytes.
- **Metadata:** `GET /resources?path=<diskPath>&fields=md5` → `{md5}` (404 if missing).
- **Delete:** `DELETE /resources?path=<diskPath>&permanently=true` → 204 (404 tolerated).
- **Create folder:** `PUT /resources?path=<diskPath>` → 201 (409 = already exists, tolerated).
- `diskPath` = `disk:/<remoteBase>/<name>` (or `disk:/<name>` if no base); the whole thing is URL-encoded in the `path` query param.

## Locked decisions

- **Port names stay** (`WebDav`/`WebDavClient`) — they're the remote-store abstraction; Yandex is just another impl. No cross-repo rename (avoids churn).
- **Encryptor** ensures the base folder exists once (lazy `PUT /resources`), then uploads. Uses Node `fetch` + `res.json()`.
- **Plugin** uses injected `RequestFn`; JSON responses decoded via crypto-core `utf8Decode`. Blob `get` = download; manifest `getConditional` = metadata md5 compare → 304 or download with `etag = md5`.
- **Device-flow `--login`** for headless token refresh is **deferred** (documented) — the browser implicit-flow token works and is pasted into config/settings for now.
- **Backend default = `webdav`** so existing configs/settings keep working unchanged.

## File structure

- `encryptor/src/types.ts` — add `backend`, `yandexToken`, `remoteBase` to `EncryptorConfig` (modify).
- `encryptor/src/config.ts` — branch validation by backend (modify).
- `encryptor/src/yandex.ts` — `YandexWebDav implements WebDav` (create).
- `encryptor/src/backend.ts` — `createBackend(config)` factory (create).
- `encryptor/src/cli.ts` — use factory instead of `new FetchWebDav` (modify).
- `plugin/src/types.ts` — add `backend`, `yandexToken` to `PluginSettings` (modify).
- `plugin/src/yandex.ts` — `YandexClient implements WebDavClient` (create).
- `plugin/src/settings.ts` — backend dropdown + token field; test-connection via factory (modify).
- `plugin/src/main.ts` — `makeClient()` factory; use in sync + test (modify).
- tests alongside each.

---

### Task 1: Encryptor config — backend fields + branch validation

**Files:**
- Modify: `encryptor/src/types.ts`, `encryptor/src/config.ts`, `encryptor/test/config.test.ts`

- [ ] **Step 1: Extend `EncryptorConfig` in `encryptor/src/types.ts`** — add after `statePath: string;`:

```ts
  backend: "webdav" | "yandex";
  yandexToken: string;
  remoteBase: string;
```

- [ ] **Step 2: Add failing tests** — append to `encryptor/test/config.test.ts`:

```ts
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
      loadConfig({ fileJson: { backend: "yandex", passphrase: "pw", sourceDir: "/v", statePath: "/s.json" }, env: {} }),
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
```

- [ ] **Step 3: Run to verify fail**

Run: `npm test -w encryptor -- config`
Expected: FAIL — backend undefined / no branch validation.

- [ ] **Step 4: Rewrite `encryptor/src/config.ts`**

```ts
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
  BACKEND: "backend",
  YANDEX_TOKEN: "yandexToken",
  REMOTE_BASE: "remoteBase",
};

const ALWAYS_REQUIRED: (keyof EncryptorConfig)[] = ["passphrase", "sourceDir", "statePath"];
const WEBDAV_REQUIRED: (keyof EncryptorConfig)[] = ["webdavUrl", "webdavUser", "webdavPass"];
const YANDEX_REQUIRED: (keyof EncryptorConfig)[] = ["yandexToken"];

export function loadConfig(opts: {
  fileJson?: PartialConfig;
  env: Record<string, string | undefined>;
}): EncryptorConfig {
  const merged: PartialConfig = { ...(opts.fileJson ?? {}) };
  for (const [envKey, cfgKey] of Object.entries(ENV_MAP)) {
    const v = opts.env[envKey];
    if (v !== undefined && v !== "") merged[cfgKey] = v;
  }

  const backend = merged.backend === "yandex" ? "yandex" : "webdav";
  const required = [...ALWAYS_REQUIRED, ...(backend === "yandex" ? YANDEX_REQUIRED : WEBDAV_REQUIRED)];
  const missing = required.filter((k) => typeof merged[k] !== "string" || merged[k] === "");
  if (missing.length) throw new Error(`Missing required config: ${missing.join(", ")}`);

  const ignore = Array.isArray(merged.ignore) ? (merged.ignore as string[]) : DEFAULT_IGNORE;

  return {
    backend,
    webdavUrl: (merged.webdavUrl as string) ?? "",
    webdavUser: (merged.webdavUser as string) ?? "",
    webdavPass: (merged.webdavPass as string) ?? "",
    yandexToken: (merged.yandexToken as string) ?? "",
    remoteBase: (merged.remoteBase as string) ?? "",
    passphrase: merged.passphrase as string,
    sourceDir: merged.sourceDir as string,
    statePath: merged.statePath as string,
    ignore,
  };
}
```

Note: `EncryptorConfig` still needs an `ignore` field — it already has it. Keep webdav fields as strings defaulting to `""`.

- [ ] **Step 5: Run to verify pass**

Run: `npm test -w encryptor -- config`
Expected: PASS (old 3 + new 4).

- [ ] **Step 6: Commit**

```bash
git add encryptor/src/types.ts encryptor/src/config.ts encryptor/test/config.test.ts
git commit -m "feat(encryptor): backend selection config (webdav | yandex)"
```

---

### Task 2: Encryptor Yandex client (`yandex.ts`)

**Files:**
- Create: `encryptor/src/yandex.ts`, `encryptor/test/yandex.test.ts`

- [ ] **Step 1: Write the failing test** — `encryptor/test/yandex.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { YandexWebDav } from "../src/yandex.js";

function recorder(handlers: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init: init ?? {} });
    return handlers(u, init ?? {});
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

describe("YandexWebDav", () => {
  it("put: ensures folder, gets upload href, PUTs body", async () => {
    const { calls, fetchFn } = recorder((url, init) => {
      if (url.includes("/resources/upload")) return new Response(JSON.stringify({ href: "https://up/put" }), { status: 200 });
      if (url === "https://up/put") return new Response(null, { status: 201 });
      if (url.includes("/resources?") || url.endsWith("/resources")) return new Response(null, { status: 201 }); // folder
      return new Response(null, { status: 500 });
    });
    const dav = new YandexWebDav({ token: "T", remoteBase: "second-brain", fetchFn });
    await dav.put("blob1", new Uint8Array([1, 2, 3]));

    const upload = calls.find((c) => c.url.includes("/resources/upload"))!;
    expect(decodeURIComponent(upload.url)).toContain("path=disk:/second-brain/blob1");
    expect(upload.url).toContain("overwrite=true");
    expect((upload.init.headers as Record<string, string>)["Authorization"]).toBe("OAuth T");
    const put = calls.find((c) => c.url === "https://up/put")!;
    expect(put.init.method).toBe("PUT");
  });

  it("del: DELETE resources with permanently=true, tolerates 404", async () => {
    const { calls, fetchFn } = recorder((url) => {
      if (url.includes("/resources?") && !url.includes("upload") && !url.includes("download")) return new Response(null, { status: 404 });
      return new Response(null, { status: 500 });
    });
    const dav = new YandexWebDav({ token: "T", remoteBase: "", fetchFn });
    await expect(dav.del("gone")).resolves.toBeUndefined();
    expect(decodeURIComponent(calls[0]!.url)).toContain("path=disk:/gone");
    expect(calls[0]!.init.method).toBe("DELETE");
  });

  it("put throws when upload href request fails", async () => {
    const { fetchFn } = recorder((url) => {
      if (url.endsWith("/resources") || (url.includes("/resources?") && !url.includes("upload"))) return new Response(null, { status: 201 });
      if (url.includes("/resources/upload")) return new Response("no", { status: 403 });
      return new Response(null, { status: 500 });
    });
    const dav = new YandexWebDav({ token: "T", remoteBase: "x", fetchFn });
    await expect(dav.put("b", new Uint8Array([1]))).rejects.toThrow(/403/);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -w encryptor -- yandex`
Expected: FAIL — cannot resolve `../src/yandex.js`.

- [ ] **Step 3: Write `encryptor/src/yandex.ts`**

```ts
import type { Bytes, WebDav } from "./types.js";

const API = "https://cloud-api.yandex.net/v1/disk";

export interface YandexWebDavOptions {
  token: string;
  remoteBase: string;
  fetchFn?: typeof fetch;
}

export class YandexWebDav implements WebDav {
  private readonly token: string;
  private readonly base: string;
  private readonly fetchFn: typeof fetch;
  private ensured = false;

  constructor(opts: YandexWebDavOptions) {
    this.token = opts.token;
    this.base = opts.remoteBase.replace(/^\/+|\/+$/g, "");
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  private headers(): Record<string, string> {
    return { Authorization: `OAuth ${this.token}` };
  }

  private diskPath(name: string): string {
    return this.base ? `disk:/${this.base}/${name}` : `disk:/${name}`;
  }

  private resourcesUrl(path: string, extra = ""): string {
    return `${API}/resources?path=${encodeURIComponent(path)}${extra}`;
  }

  private async ensureBase(): Promise<void> {
    if (this.ensured || !this.base) {
      this.ensured = true;
      return;
    }
    const res = await this.fetchFn(this.resourcesUrl(`disk:/${this.base}`), {
      method: "PUT",
      headers: this.headers(),
    });
    if (res.status !== 201 && res.status !== 409) {
      throw new Error(`create folder failed: ${res.status}`);
    }
    this.ensured = true;
  }

  async put(name: string, body: Bytes): Promise<void> {
    await this.ensureBase();
    const up = await this.fetchFn(
      `${API}/resources/upload?path=${encodeURIComponent(this.diskPath(name))}&overwrite=true`,
      { headers: this.headers() },
    );
    if (!up.ok) throw new Error(`upload href ${name} failed: ${up.status}`);
    const { href } = (await up.json()) as { href: string };
    const put = await this.fetchFn(href, { method: "PUT", body });
    if (!put.ok) throw new Error(`PUT ${name} failed: ${put.status}`);
  }

  async del(name: string): Promise<void> {
    const res = await this.fetchFn(this.resourcesUrl(this.diskPath(name), "&permanently=true"), {
      method: "DELETE",
      headers: this.headers(),
    });
    if (!res.ok && res.status !== 404) throw new Error(`DELETE ${name} failed: ${res.status}`);
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -w encryptor -- yandex`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add encryptor/src/yandex.ts encryptor/test/yandex.test.ts
git commit -m "feat(encryptor): Yandex.Disk REST backend client"
```

---

### Task 3: Encryptor backend factory + CLI wiring

**Files:**
- Create: `encryptor/src/backend.ts`, `encryptor/test/backend.test.ts`
- Modify: `encryptor/src/cli.ts`

- [ ] **Step 1: Write the failing test** — `encryptor/test/backend.test.ts`

```ts
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
    expect(createBackend({ ...base, backend: "yandex", yandexToken: "T" })).toBeInstanceOf(YandexWebDav);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -w encryptor -- backend`
Expected: FAIL — cannot resolve `../src/backend.js`.

- [ ] **Step 3: Write `encryptor/src/backend.ts`**

```ts
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -w encryptor -- backend`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire `encryptor/src/cli.ts`** — replace the `FetchWebDav` construction. Change import block to add:

```ts
import { createBackend } from "./backend.js";
```

and remove the direct `FetchWebDav` import + usage, replacing:

```ts
  const webdav = new FetchWebDav({
    baseUrl: config.webdavUrl,
    user: config.webdavUser,
    pass: config.webdavPass,
  });
```

with:

```ts
  const webdav = createBackend(config);
```

- [ ] **Step 6: Typecheck + full encryptor tests**

Run: `npm run typecheck -w encryptor && npm test -w encryptor`
Expected: clean; all encryptor tests pass.

- [ ] **Step 7: Commit**

```bash
git add encryptor/src/backend.ts encryptor/src/cli.ts encryptor/test/backend.test.ts
git commit -m "feat(encryptor): backend factory + CLI wiring"
```

---

### Task 4: Plugin settings — backend fields

**Files:**
- Modify: `plugin/src/types.ts`, and update fakes in tests that build `PluginSettings`.

- [ ] **Step 1: Extend `PluginSettings` in `plugin/src/types.ts`** — add after `syncOnOpen: boolean;`:

```ts
  backend: "webdav" | "yandex";
  yandexToken: string;
```

- [ ] **Step 2: Update the engine test settings helper** — in `plugin/test/engine.test.ts`, add to the `settings()` object:

```ts
  backend: "webdav",
  yandexToken: "",
```

- [ ] **Step 3: Update the validate test `ok` object** — in `plugin/test/validate.test.ts` add:

```ts
  backend: "webdav",
  yandexToken: "",
```

- [ ] **Step 4: Run tests to confirm still green (typecheck later in Task 6)**

Run: `npm test -w plugin -- engine validate`
Expected: PASS (behavior unchanged).

- [ ] **Step 5: Commit**

```bash
git add plugin/src/types.ts plugin/test/engine.test.ts plugin/test/validate.test.ts
git commit -m "feat(plugin): backend + yandexToken settings fields"
```

---

### Task 5: Plugin Yandex client (`yandex.ts`)

**Files:**
- Create: `plugin/src/yandex.ts`, `plugin/test/yandex.test.ts`

- [ ] **Step 1: Write the failing test** — `plugin/test/yandex.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { YandexClient } from "../src/yandex.js";
import type { RequestArg, RequestResponse } from "../src/types.js";

const enc = (obj: unknown): ArrayBuffer =>
  new TextEncoder().encode(JSON.stringify(obj)).buffer as ArrayBuffer;

function router(handlers: (arg: RequestArg) => RequestResponse) {
  const calls: RequestArg[] = [];
  const request = async (arg: RequestArg): Promise<RequestResponse> => {
    calls.push(arg);
    return handlers(arg);
  };
  return { calls, request };
}

describe("YandexClient.get", () => {
  it("resolves download href then fetches bytes", async () => {
    const { calls, request } = router((arg) => {
      if (arg.url.includes("/resources/download")) return { status: 200, arrayBuffer: enc({ href: "https://dl/get" }) };
      if (arg.url === "https://dl/get") return { status: 200, arrayBuffer: new Uint8Array([9, 8, 7]).buffer as ArrayBuffer };
      return { status: 500, arrayBuffer: new ArrayBuffer(0) };
    });
    const c = new YandexClient({ token: "T", remoteBase: "second-brain", request });
    const bytes = await c.get("blob1");
    expect(decodeURIComponent(calls[0]!.url)).toContain("path=disk:/second-brain/blob1");
    expect(calls[0]!.headers!["Authorization"]).toBe("OAuth T");
    expect([...bytes]).toEqual([9, 8, 7]);
  });
});

describe("YandexClient.getConditional", () => {
  it("returns 304 when md5 matches the stored etag", async () => {
    const { request } = router((arg) => {
      if (arg.url.includes("/resources?")) return { status: 200, arrayBuffer: enc({ md5: "abc" }) };
      return { status: 500, arrayBuffer: new ArrayBuffer(0) };
    });
    const c = new YandexClient({ token: "T", remoteBase: "", request });
    const res = await c.getConditional("manifest.enc", "abc");
    expect(res.status).toBe(304);
    expect(res.body).toBeUndefined();
  });

  it("downloads and returns md5 as etag when changed", async () => {
    const { request } = router((arg) => {
      if (arg.url.includes("/resources?")) return { status: 200, arrayBuffer: enc({ md5: "new" }) };
      if (arg.url.includes("/resources/download")) return { status: 200, arrayBuffer: enc({ href: "https://dl/m" }) };
      if (arg.url === "https://dl/m") return { status: 200, arrayBuffer: new Uint8Array([1]).buffer as ArrayBuffer };
      return { status: 500, arrayBuffer: new ArrayBuffer(0) };
    });
    const c = new YandexClient({ token: "T", remoteBase: "", request });
    const res = await c.getConditional("manifest.enc", "old");
    expect(res.status).toBe(200);
    expect([...res.body!]).toEqual([1]);
    expect(res.etag).toBe("new");
  });

  it("throws when the manifest metadata is 404", async () => {
    const { request } = router(() => ({ status: 404, arrayBuffer: new ArrayBuffer(0) }));
    const c = new YandexClient({ token: "T", remoteBase: "", request });
    await expect(c.getConditional("manifest.enc")).rejects.toThrow(/404/);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -w plugin -- yandex`
Expected: FAIL — cannot resolve `../src/yandex.js`.

- [ ] **Step 3: Write `plugin/src/yandex.ts`**

```ts
import { utf8Decode } from "crypto-core";
import type { Bytes, ConditionalGet, RequestFn, WebDavClient } from "./types.js";

const API = "https://cloud-api.yandex.net/v1/disk";

export interface YandexClientOptions {
  token: string;
  remoteBase: string;
  request: RequestFn;
}

export class YandexClient implements WebDavClient {
  private readonly token: string;
  private readonly base: string;
  private readonly request: RequestFn;

  constructor(opts: YandexClientOptions) {
    this.token = opts.token;
    this.base = opts.remoteBase.replace(/^\/+|\/+$/g, "");
    this.request = opts.request;
  }

  private auth(): Record<string, string> {
    return { Authorization: `OAuth ${this.token}` };
  }

  private diskPath(name: string): string {
    return this.base ? `disk:/${this.base}/${name}` : `disk:/${name}`;
  }

  private json(bytes: ArrayBuffer): unknown {
    return JSON.parse(utf8Decode(new Uint8Array(bytes)));
  }

  private async download(name: string): Promise<Bytes> {
    const meta = await this.request({
      url: `${API}/resources/download?path=${encodeURIComponent(this.diskPath(name))}`,
      method: "GET",
      headers: this.auth(),
      throw: false,
    });
    if (meta.status < 200 || meta.status >= 300) {
      throw new Error(`GET ${name} failed: ${meta.status}`);
    }
    const { href } = this.json(meta.arrayBuffer) as { href: string };
    const file = await this.request({ url: href, method: "GET", throw: false });
    if (file.status < 200 || file.status >= 300) {
      throw new Error(`GET ${name} failed: ${file.status}`);
    }
    return new Uint8Array(file.arrayBuffer);
  }

  async get(name: string): Promise<Bytes> {
    return this.download(name);
  }

  async getConditional(name: string, etag?: string): Promise<ConditionalGet> {
    const meta = await this.request({
      url: `${API}/resources?path=${encodeURIComponent(this.diskPath(name))}&fields=md5`,
      method: "GET",
      headers: this.auth(),
      throw: false,
    });
    if (meta.status < 200 || meta.status >= 300) {
      throw new Error(`GET ${name} failed: ${meta.status}`);
    }
    const md5 = (this.json(meta.arrayBuffer) as { md5?: string }).md5;
    if (etag && md5 === etag) return { status: 304 };
    const body = await this.download(name);
    return { status: 200, body, etag: md5 };
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -w plugin -- yandex`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add plugin/src/yandex.ts plugin/test/yandex.test.ts
git commit -m "feat(plugin): Yandex.Disk REST client"
```

---

### Task 6: Plugin backend factory + settings UI

**Files:**
- Modify: `plugin/src/main.ts`, `plugin/src/settings.ts`

Runtime — verified by typecheck + build.

- [ ] **Step 1: Add `makeClient()` to `plugin/src/main.ts`** and use it. Add import:

```ts
import { YandexClient } from "./yandex.js";
import type { WebDavClient } from "./types.js";
```

Add a method:

```ts
  makeClient(): WebDavClient {
    if (this.settings.backend === "yandex") {
      return new YandexClient({
        token: this.settings.yandexToken,
        remoteBase: this.settings.remoteBase,
        request: this.makeRequest(),
      });
    }
    return new ObsidianWebDavClient({
      baseUrl: this.settings.webdavUrl,
      remoteBase: this.settings.remoteBase,
      user: this.settings.webdavUser,
      pass: this.settings.webdavPass,
      request: this.makeRequest(),
    });
  }
```

In `syncNow()`, replace the `const webdav = new ObsidianWebDavClient({...})` block with:

```ts
      const webdav = this.makeClient();
```

- [ ] **Step 2: Update `plugin/src/settings.ts`** — extend `DEFAULT_SETTINGS`, add backend dropdown + token field, and make Test connection use the factory.

Add to `DEFAULT_SETTINGS`:

```ts
  backend: "webdav",
  yandexToken: "",
```

At the top of `display()` (before the WebDAV fields), add a backend selector:

```ts
    new Setting(containerEl)
      .setName("Backend")
      .setDesc("WebDAV server or Yandex.Disk (REST API)")
      .addDropdown((d) => {
        d.addOption("webdav", "WebDAV");
        d.addOption("yandex", "Yandex.Disk");
        d.setValue(s.backend).onChange(async (v) => {
          s.backend = v === "yandex" ? "yandex" : "webdav";
          await this.plugin.saveSettings();
          this.display(); // re-render to show relevant fields
        });
      });
```

Wrap the WebDAV-only fields (URL / Username / Password) so they only show for webdav, and add a token field for yandex. Replace the three `textField(... "webdavUrl"/"webdavUser"/"webdavPass" ...)` calls with:

```ts
    if (s.backend === "webdav") {
      textField("WebDAV URL", "Base URL of the WebDAV server", "webdavUrl");
      textField("Username", "WebDAV user", "webdavUser");
      textField("Password", "WebDAV password", "webdavPass", true);
    } else {
      textField("Yandex.Disk OAuth token", "Access token with cloud_api:disk.read/write", "yandexToken", true);
    }
```

Add `"yandexToken"` to the `STRING_KEYS` tuple so `textField` accepts it.

Replace the Test-connection client construction (the `new ObsidianWebDavClient({...})`) with `this.plugin.makeClient()`.

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck -w plugin && npm run build -w plugin`
Expected: clean; "Built main.js".

- [ ] **Step 4: Commit**

```bash
git add plugin/src/main.ts plugin/src/settings.ts
git commit -m "feat(plugin): backend factory + settings (WebDAV | Yandex.Disk)"
```

---

### Task 7: Full suite + typecheck + builds + docs

- [ ] **Step 1: Everything green**

Run: `npm test && npm run typecheck && npm run build -w encryptor && npm run build -w plugin`
Expected: all tests pass; typechecks clean; both bundles build.

- [ ] **Step 2: Update `CLAUDE.md` + `README.md`** — note the `yandex` backend: encryptor config keys `backend`/`yandexToken`/`remoteBase` (+ `YANDEX_TOKEN`/`REMOTE_BASE` env); plugin Backend dropdown + OAuth token; how to get a token (implicit flow URL); device-flow refresh deferred.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: document Yandex.Disk backend"
```

---

### Task 8: Real e2e against Yandex.Disk (manual verification)

Not a committed test (needs a live token) — a scratchpad run mirroring the WebDAV e2e.

- [ ] **Step 1:** Build encryptor; write a scratchpad `config.json` with `backend:"yandex"`, `yandexToken`, `remoteBase:"second-brain-rest"`, a small test vault.
- [ ] **Step 2:** `node encryptor/encryptor.mjs --config <cfg>` → expect `uploaded N`.
- [ ] **Step 3:** Bundle a harness that drives the plugin `SyncEngine` with `YandexClient` (fetch-based `RequestFn`) → download+decrypt to a dir → `diff -r` against the source vault → IDENTICAL.
- [ ] **Step 4:** Modify + re-run → incremental (`uploaded`/`deleted`) and md5-based not-modified behave.
- [ ] **Step 5:** Clean up remote test folder.

---

## Self-review notes

- **Spec/goal coverage:** Yandex REST for both encryptor (upload/delete + folder ensure) and plugin (download + md5 conditional); backend selection in config + settings; defaults keep WebDAV working. Device-flow `--login` deferred (documented).
- **Ports unchanged:** `WebDav`/`WebDavClient` reused; `encryptSync`/`SyncEngine`/crypto untouched → low risk.
- **Testability:** both Yandex clients injected (`fetchFn` / `RequestFn`), unit-tested for path building, two-step transfer, md5 conditional, error paths. Only settings/main/cli glue is runtime (typecheck + build + the Task 8 e2e).
- **Type consistency:** `backend: "webdav" | "yandex"`, `yandexToken`, `remoteBase` added once per package; `ConditionalGet`/`Bytes` reused; factory return types are the existing ports.
