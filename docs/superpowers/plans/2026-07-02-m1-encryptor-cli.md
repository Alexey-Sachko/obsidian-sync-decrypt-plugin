# M1 · Encryptor CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A single-file, zero-dependency Node ≥ 20 CLI (`encryptor.mjs`) that incrementally encrypts a source vault with `crypto-core` and syncs the blobs + `manifest.enc` to WebDAV via built-in `fetch`.

**Architecture:** Layered and dependency-injected so the core sync algorithm is testable without real fs/network. `crypto-core` is consumed as a workspace package (same byte format as the plugin). The core `encryptSync` orchestrator takes abstract `SourceFs` + `WebDav` ports; Node adapters (`NodeSourceFs`, `FetchWebDav`) implement them for production. esbuild bundles CLI + crypto-core into one ESM file for VPS deploy.

**Tech Stack:** TypeScript 6, Node ≥ 20 (`node:fs/promises`, `node:path`, global `fetch`, global Web Crypto), Vitest, esbuild.

---

## Monorepo decision

Convert the repo to **npm workspaces** (`["crypto-core", "encryptor"]`). Shared dev tooling (typescript, vitest) hoists to the root; `encryptor` depends on `crypto-core` via workspace resolution so `import { deriveKeys } from "crypto-core"` works in tsc, vitest, and esbuild. `crypto-core` gets a `types`/`exports` entry so it resolves as a package.

## Locked behavior decisions (SPEC §5)

- **Salt:** generated once (`crypto.getRandomValues(16)`) on first run, persisted base64 in `state.json`, reused forever. Losing/regenerating it changes every remote name.
- **State file (`state.json`):** `{ "salt": "<base64>", "files": { "<relPath>": { "sha256", "name", "mtime" } } }`.
- **Change detection:** read every source file each run, `sha256Hex(plaintext)`; unchanged (sha equals state) → skip encrypt+PUT but still list in manifest. `--full` forces re-encrypt of everything.
- **Deletions:** paths in `state.files` absent from the current walk → `DELETE` their remote name, drop from state.
- **Ignore rules:** default-ignore top-level and nested `.obsidian`, `.trash`, `.git` directory segments; configurable.
- **Manifest:** rebuilt every run from all current files, sorted by path for determinism, encrypted with `encryptManifest`, `PUT` as `manifest.enc`.
- **WebDAV:** `PUT`/`DELETE` on `fetch`, HTTP Basic auth, `remoteBase` URL joined with `/`. Non-2xx → throw.

## File structure

- `package.json` (root) — workspaces + shared devDeps + scripts.
- `encryptor/package.json` — `"type": "module"`, depends on `crypto-core`, scripts (test, typecheck, build).
- `encryptor/tsconfig.json` — strict, `lib: ES2022 + DOM` (for Web Crypto types), `types: ["node"]` (Node adapters may use node types).
- `encryptor/src/types.ts` — `SyncState`, `SourceFile`, `SourceFs`, `WebDav`, `SyncStats`, `EncryptorConfig`.
- `encryptor/src/state.ts` — `parseState`, `serializeState` (salt base64 ⇄ Bytes).
- `encryptor/src/walk.ts` — `NodeSourceFs` (walk + read with ignore rules).
- `encryptor/src/webdav.ts` — `FetchWebDav` (put/del, Basic auth, injectable fetch).
- `encryptor/src/config.ts` — `loadConfig` (config.json + env, validation).
- `encryptor/src/sync.ts` — `encryptSync(deps)` core orchestrator.
- `encryptor/src/cli.ts` — `parseArgs`, `main` (wire real adapters, load/save state, print stats).
- `encryptor/esbuild.config.mjs` — bundle → `encryptor.mjs`.
- `encryptor/test/*.test.ts` — per-module tests + in-memory fakes.

---

### Task 1: Convert to npm workspaces + encryptor scaffold

**Files:**
- Create: `package.json` (root), `encryptor/package.json`, `encryptor/tsconfig.json`, `encryptor/vitest.config.ts`
- Modify: `crypto-core/package.json` (add `types`/`exports`, drop hoisted devDeps), `.vscode/settings.json` (tsdk → root)

- [ ] **Step 1: Write root `package.json`**

```json
{
  "name": "obsidian-sync-decrypt",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "workspaces": ["crypto-core", "encryptor"],
  "scripts": {
    "test": "npm run test --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present"
  },
  "devDependencies": {
    "typescript": "^6.0.3",
    "vitest": "^2.1.9",
    "esbuild": "^0.24.0"
  }
}
```

- [ ] **Step 2: Update `crypto-core/package.json`** — make it resolvable as a package, drop hoisted devDeps.

```json
{
  "name": "crypto-core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 3: Write `encryptor/package.json`**

```json
{
  "name": "encryptor",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "build": "node esbuild.config.mjs"
  },
  "dependencies": {
    "crypto-core": "*"
  }
}
```

- [ ] **Step 4: Write `encryptor/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"],
    "noEmit": true
  },
  "include": ["src", "test", "esbuild.config.mjs"]
}
```

- [ ] **Step 5: Write `encryptor/vitest.config.ts`** (identical shape to crypto-core's)

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["test/**/*.test.ts"] },
});
```

- [ ] **Step 6: Reinstall as workspaces**

```bash
rm -rf crypto-core/node_modules crypto-core/package-lock.json
npm install
```
Expected: single root `node_modules`, `@types/node` present (via esbuild? no — add it). If `@types/node` missing, run `npm install -D @types/node@^20 -w encryptor` (root-hoisted).

- [ ] **Step 7: Point IDE at root TS** — `.vscode/settings.json`

```json
{
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true
}
```

- [ ] **Step 8: Verify crypto-core still green through workspaces**

Run: `npm run test -w crypto-core && npm run typecheck -w crypto-core`
Expected: 24 tests pass, typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: npm workspaces + encryptor scaffold"
```

---

### Task 2: State parse/serialize (`state.ts` + `types.ts`)

**Files:**
- Create: `encryptor/src/types.ts`, `encryptor/src/state.ts`, `encryptor/test/state.test.ts`

- [ ] **Step 1: Write `encryptor/src/types.ts`** (shared types; no test)

```ts
import type { Bytes, Manifest } from "crypto-core";

export interface StateFileEntry {
  sha256: string;
  name: string;
  mtime: number;
}

export interface SyncState {
  salt: Bytes;
  files: Record<string, StateFileEntry>;
}

export interface SourceFile {
  /** Vault-relative POSIX path, e.g. "Notes/idea.md". */
  path: string;
  mtime: number;
  size: number;
}

export interface SourceFs {
  walk(): Promise<SourceFile[]>;
  read(path: string): Promise<Bytes>;
}

export interface WebDav {
  put(name: string, body: Bytes): Promise<void>;
  del(name: string): Promise<void>;
}

export interface SyncStats {
  uploaded: number;
  skipped: number;
  deleted: number;
}

export interface EncryptorConfig {
  webdavUrl: string;
  webdavUser: string;
  webdavPass: string;
  passphrase: string;
  sourceDir: string;
  statePath: string;
  ignore: string[];
}

export type { Bytes, Manifest };
```

- [ ] **Step 2: Write the failing test** — `encryptor/test/state.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { parseState, serializeState, newState } from "../src/state.js";

describe("state", () => {
  it("newState makes a 16-byte salt and empty files", () => {
    const s = newState();
    expect(s.salt.length).toBe(16);
    expect(s.files).toEqual({});
  });

  it("round-trips through serialize/parse (salt preserved)", () => {
    const s = newState();
    s.files["a.md"] = { sha256: "de", name: "xyz", mtime: 5 };
    const json = serializeState(s);
    const back = parseState(json);
    expect([...back.salt]).toEqual([...s.salt]);
    expect(back.files).toEqual(s.files);
  });

  it("serialize writes salt as base64 string", () => {
    const s = newState();
    const parsed = JSON.parse(serializeState(s));
    expect(typeof parsed.salt).toBe("string");
    expect(Buffer.from(parsed.salt, "base64").length).toBe(16);
  });
});
```

- [ ] **Step 2b: Run to verify fail**

Run: `npm run test -w encryptor -- state`
Expected: FAIL — cannot resolve `../src/state.js`.

- [ ] **Step 3: Write `encryptor/src/state.ts`**

```ts
import type { SyncState } from "./types.js";

export function newState(): SyncState {
  return { salt: crypto.getRandomValues(new Uint8Array(16)), files: {} };
}

export function serializeState(state: SyncState): string {
  return JSON.stringify(
    { salt: Buffer.from(state.salt).toString("base64"), files: state.files },
    null,
    2,
  );
}

export function parseState(json: string): SyncState {
  const raw = JSON.parse(json) as { salt: string; files: SyncState["files"] };
  return {
    salt: new Uint8Array(Buffer.from(raw.salt, "base64")),
    files: raw.files ?? {},
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -w encryptor -- state`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add encryptor/src/types.ts encryptor/src/state.ts encryptor/test/state.test.ts
git commit -m "feat(encryptor): sync state parse/serialize"
```

---

### Task 3: WebDAV client (`webdav.ts`)

**Files:**
- Create: `encryptor/src/webdav.ts`, `encryptor/test/webdav.test.ts`

Design: `FetchWebDav` takes `{ baseUrl, user, pass, fetchFn = fetch }`. `put`/`del` join `baseUrl` + `/` + name, set `Authorization: Basic base64(user:pass)`, throw on non-2xx.

- [ ] **Step 1: Write the failing test** — `encryptor/test/webdav.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { FetchWebDav } from "../src/webdav.js";

function fakeFetch() {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(null, { status: 201 });
  };
  return { calls, fetchFn: fetchFn as unknown as typeof fetch };
}

describe("FetchWebDav", () => {
  it("PUTs to baseUrl/name with Basic auth and body", async () => {
    const { calls, fetchFn } = fakeFetch();
    const dav = new FetchWebDav({ baseUrl: "https://x/dav/", user: "u", pass: "p", fetchFn });
    await dav.put("blob1", new Uint8Array([1, 2, 3]));
    expect(calls[0]!.url).toBe("https://x/dav/blob1");
    expect(calls[0]!.init.method).toBe("PUT");
    const auth = (calls[0]!.init.headers as Record<string, string>)["Authorization"];
    expect(auth).toBe("Basic " + Buffer.from("u:p").toString("base64"));
  });

  it("DELETEs baseUrl/name", async () => {
    const { calls, fetchFn } = fakeFetch();
    const dav = new FetchWebDav({ baseUrl: "https://x/dav", user: "u", pass: "p", fetchFn });
    await dav.del("blob2");
    expect(calls[0]!.url).toBe("https://x/dav/blob2");
    expect(calls[0]!.init.method).toBe("DELETE");
  });

  it("throws on non-2xx", async () => {
    const fetchFn = (async () => new Response(null, { status: 500 })) as unknown as typeof fetch;
    const dav = new FetchWebDav({ baseUrl: "https://x", user: "u", pass: "p", fetchFn });
    await expect(dav.put("b", new Uint8Array([1]))).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm run test -w encryptor -- webdav`
Expected: FAIL — cannot resolve `../src/webdav.js`.

- [ ] **Step 3: Write `encryptor/src/webdav.ts`**

```ts
import type { Bytes, WebDav } from "./types.js";

export interface FetchWebDavOptions {
  baseUrl: string;
  user: string;
  pass: string;
  fetchFn?: typeof fetch;
}

export class FetchWebDav implements WebDav {
  private readonly base: string;
  private readonly auth: string;
  private readonly fetchFn: typeof fetch;

  constructor(opts: FetchWebDavOptions) {
    this.base = opts.baseUrl.replace(/\/+$/, "");
    this.auth = "Basic " + Buffer.from(`${opts.user}:${opts.pass}`).toString("base64");
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  private url(name: string): string {
    return `${this.base}/${name}`;
  }

  async put(name: string, body: Bytes): Promise<void> {
    const res = await this.fetchFn(this.url(name), {
      method: "PUT",
      headers: { Authorization: this.auth },
      body,
    });
    if (!res.ok) throw new Error(`PUT ${name} failed: ${res.status}`);
  }

  async del(name: string): Promise<void> {
    const res = await this.fetchFn(this.url(name), {
      method: "DELETE",
      headers: { Authorization: this.auth },
    });
    // 404 on delete is fine (already gone); other non-2xx throws.
    if (!res.ok && res.status !== 404) throw new Error(`DELETE ${name} failed: ${res.status}`);
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -w encryptor -- webdav`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add encryptor/src/webdav.ts encryptor/test/webdav.test.ts
git commit -m "feat(encryptor): fetch-based WebDAV client"
```

---

### Task 4: Source walker (`walk.ts`)

**Files:**
- Create: `encryptor/src/walk.ts`, `encryptor/test/walk.test.ts`

Design: `NodeSourceFs(rootDir, ignore)` — `walk()` recursively lists files, skipping any path whose segments include an ignored name; returns POSIX-relative paths with mtime (epoch seconds) + size. `read(path)` reads bytes as `Bytes`.

- [ ] **Step 1: Write the failing test** — `encryptor/test/walk.test.ts` (uses a real temp dir)

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeSourceFs } from "../src/walk.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "walk-"));
  mkdirSync(join(dir, "Notes"));
  mkdirSync(join(dir, ".obsidian"));
  writeFileSync(join(dir, "root.md"), "root");
  writeFileSync(join(dir, "Notes", "a.md"), "aaa");
  writeFileSync(join(dir, ".obsidian", "app.json"), "{}");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("NodeSourceFs", () => {
  it("walks files with POSIX relative paths, skipping ignored dirs", async () => {
    const fs = new NodeSourceFs(dir, [".obsidian", ".trash", ".git"]);
    const files = (await fs.walk()).map((f) => f.path).sort();
    expect(files).toEqual(["Notes/a.md", "root.md"]);
  });

  it("read returns the file bytes", async () => {
    const fs = new NodeSourceFs(dir, []);
    const bytes = await fs.read("Notes/a.md");
    expect(new TextDecoder().decode(bytes)).toBe("aaa");
  });

  it("reports size", async () => {
    const fs = new NodeSourceFs(dir, []);
    const root = (await fs.walk()).find((f) => f.path === "root.md");
    expect(root!.size).toBe(4);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm run test -w encryptor -- walk`
Expected: FAIL — cannot resolve `../src/walk.js`.

- [ ] **Step 3: Write `encryptor/src/walk.ts`**

```ts
import { readdir, readFile, stat } from "node:fs/promises";
import { join, posix, sep } from "node:path";
import type { Bytes, SourceFile, SourceFs } from "./types.js";

export class NodeSourceFs implements SourceFs {
  constructor(
    private readonly root: string,
    private readonly ignore: string[],
  ) {}

  async walk(): Promise<SourceFile[]> {
    const out: SourceFile[] = [];
    await this.walkDir(this.root, "", out);
    return out;
  }

  private async walkDir(absDir: string, relDir: string, out: SourceFile[]): Promise<void> {
    const entries = await readdir(absDir, { withFileTypes: true });
    for (const entry of entries) {
      if (this.ignore.includes(entry.name)) continue;
      const abs = join(absDir, entry.name);
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await this.walkDir(abs, rel, out);
      } else if (entry.isFile()) {
        const s = await stat(abs);
        out.push({ path: rel, mtime: Math.floor(s.mtimeMs / 1000), size: s.size });
      }
    }
  }

  async read(path: string): Promise<Bytes> {
    const abs = join(this.root, ...path.split(posix.sep));
    const buf = await readFile(abs);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength).slice();
  }
}

// `sep` imported to document platform-join intent; paths stored POSIX-style.
void sep;
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -w encryptor -- walk`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add encryptor/src/walk.ts encryptor/test/walk.test.ts
git commit -m "feat(encryptor): node source walker with ignore rules"
```

---

### Task 5: Core sync orchestrator (`sync.ts`)

**Files:**
- Create: `encryptor/src/sync.ts`, `encryptor/test/sync.test.ts`

Design: `encryptSync({ source, webdav, passphrase, state, full, now })` derives keys from `state.salt`, walks source, uploads changed/new blobs, deletes vanished ones, rebuilds+PUTs `manifest.enc`, returns `{ state, stats }`. In-memory fakes for `source`/`webdav` in tests; assert PUT/DELETE names and that skips avoid re-upload. Manifest is decrypted back with crypto-core to assert its contents.

- [ ] **Step 1: Write the failing test** — `encryptor/test/sync.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { encryptSync } from "../src/sync.js";
import { newState } from "../src/state.js";
import {
  deriveKeys,
  deriveName,
  decryptManifest,
  readManifestSalt,
  sha256Hex,
  utf8Encode,
} from "crypto-core";
import type { Bytes, SourceFile, SourceFs, WebDav } from "../src/types.js";

class FakeSource implements SourceFs {
  constructor(public files: Map<string, string>) {}
  async walk(): Promise<SourceFile[]> {
    return [...this.files.keys()].map((path) => ({
      path,
      mtime: 1,
      size: this.files.get(path)!.length,
    }));
  }
  async read(path: string): Promise<Bytes> {
    return utf8Encode(this.files.get(path)!);
  }
}

class FakeDav implements WebDav {
  puts = new Map<string, Bytes>();
  dels: string[] = [];
  async put(name: string, body: Bytes) {
    this.puts.set(name, body);
  }
  async del(name: string) {
    this.dels.push(name);
  }
}

const now = () => new Date("2026-07-02T00:00:00Z");

describe("encryptSync", () => {
  it("uploads every file on first run and writes a decryptable manifest", async () => {
    const source = new FakeSource(new Map([["a.md", "alpha"], ["Notes/b.md", "bravo"]]));
    const dav = new FakeDav();
    const { state, stats } = await encryptSync({
      source,
      webdav: dav,
      passphrase: "pw",
      state: newState(),
      now,
    });

    expect(stats).toEqual({ uploaded: 2, skipped: 0, deleted: 0 });

    const { contentKey, nameKey } = await deriveKeys("pw", state.salt);
    const nameA = await deriveName(nameKey, "a.md");
    expect(dav.puts.has(nameA)).toBe(true);
    expect(dav.puts.has("manifest.enc")).toBe(true);

    const enc = dav.puts.get("manifest.enc")!;
    expect([...readManifestSalt(enc)]).toEqual([...state.salt]);
    const manifest = await decryptManifest(enc, contentKey);
    expect(manifest.files.map((f) => f.path)).toEqual(["Notes/b.md", "a.md"].sort());
    const a = manifest.files.find((f) => f.path === "a.md")!;
    expect(a.sha256).toBe(await sha256Hex(utf8Encode("alpha")));
    expect(a.name).toBe(nameA);
  });

  it("skips unchanged files on the second run", async () => {
    const source = new FakeSource(new Map([["a.md", "alpha"]]));
    const dav1 = new FakeDav();
    const r1 = await encryptSync({ source, webdav: dav1, passphrase: "pw", state: newState(), now });

    const dav2 = new FakeDav();
    const r2 = await encryptSync({ source, webdav: dav2, passphrase: "pw", state: r1.state, now });

    expect(r2.stats).toEqual({ uploaded: 0, skipped: 1, deleted: 0 });
    // only manifest re-PUT, no blob
    expect([...dav2.puts.keys()]).toEqual(["manifest.enc"]);
  });

  it("deletes vanished files and drops them from state", async () => {
    const source1 = new FakeSource(new Map([["a.md", "alpha"], ["gone.md", "x"]]));
    const dav1 = new FakeDav();
    const r1 = await encryptSync({ source: source1, webdav: dav1, passphrase: "pw", state: newState(), now });
    const { nameKey } = await deriveKeys("pw", r1.state.salt);
    const goneName = await deriveName(nameKey, "gone.md");

    const source2 = new FakeSource(new Map([["a.md", "alpha"]]));
    const dav2 = new FakeDav();
    const r2 = await encryptSync({ source: source2, webdav: dav2, passphrase: "pw", state: r1.state, now });

    expect(r2.stats.deleted).toBe(1);
    expect(dav2.dels).toEqual([goneName]);
    expect(r2.state.files["gone.md"]).toBeUndefined();
  });

  it("--full re-uploads even unchanged files", async () => {
    const source = new FakeSource(new Map([["a.md", "alpha"]]));
    const r1 = await encryptSync({ source, webdav: new FakeDav(), passphrase: "pw", state: newState(), now });
    const dav2 = new FakeDav();
    const r2 = await encryptSync({ source, webdav: dav2, passphrase: "pw", state: r1.state, full: true, now });
    expect(r2.stats.uploaded).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm run test -w encryptor -- sync`
Expected: FAIL — cannot resolve `../src/sync.js`.

- [ ] **Step 3: Write `encryptor/src/sync.ts`**

```ts
import {
  deriveKeys,
  deriveName,
  encryptBlob,
  encryptManifest,
  sha256Hex,
  type Manifest,
} from "crypto-core";
import type { SourceFs, SyncState, SyncStats, WebDav } from "./types.js";

export interface EncryptSyncDeps {
  source: SourceFs;
  webdav: WebDav;
  passphrase: string;
  state: SyncState;
  full?: boolean;
  now?: () => Date;
}

export interface EncryptSyncResult {
  state: SyncState;
  stats: SyncStats;
}

export async function encryptSync(deps: EncryptSyncDeps): Promise<EncryptSyncResult> {
  const { source, webdav, passphrase, state } = deps;
  const now = deps.now ?? (() => new Date());
  const full = deps.full ?? false;

  const { contentKey, nameKey } = await deriveKeys(passphrase, state.salt);

  const files = await source.walk();
  const nextFiles: SyncState["files"] = {};
  const manifestFiles: Manifest["files"] = [];
  const stats: SyncStats = { uploaded: 0, skipped: 0, deleted: 0 };

  for (const file of files) {
    const plaintext = await source.read(file.path);
    const sha = await sha256Hex(plaintext);
    const name = await deriveName(nameKey, file.path);
    const prior = state.files[file.path];

    if (!full && prior && prior.sha256 === sha) {
      stats.skipped++;
    } else {
      const blob = await encryptBlob(contentKey, plaintext);
      await webdav.put(name, blob);
      stats.uploaded++;
    }

    nextFiles[file.path] = { sha256: sha, name, mtime: file.mtime };
    manifestFiles.push({ path: file.path, name, size: plaintext.length, sha256: sha, mtime: file.mtime });
  }

  for (const [path, entry] of Object.entries(state.files)) {
    if (!nextFiles[path]) {
      await webdav.del(entry.name);
      stats.deleted++;
    }
  }

  manifestFiles.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const manifest: Manifest = {
    version: 1,
    generatedAt: now().toISOString(),
    files: manifestFiles,
  };
  const enc = await encryptManifest(manifest, state.salt, contentKey);
  await webdav.put("manifest.enc", enc);

  return { state: { salt: state.salt, files: nextFiles }, stats };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -w encryptor -- sync`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add encryptor/src/sync.ts encryptor/test/sync.test.ts
git commit -m "feat(encryptor): core encrypt-sync orchestrator"
```

---

### Task 6: Config loader (`config.ts`)

**Files:**
- Create: `encryptor/src/config.ts`, `encryptor/test/config.test.ts`

Design: `loadConfig({ fileJson?, env })` merges config.json object with env vars (`WEBDAV_URL`, `WEBDAV_USER`, `WEBDAV_PASS`, `PASSPHRASE`, `SOURCE_DIR`, `STATE_PATH`); env wins; validates required fields; `ignore` defaults to `[".obsidian", ".trash", ".git"]`. Pure function (no fs) for testability; the CLI reads the file and passes the object.

- [ ] **Step 1: Write the failing test** — `encryptor/test/config.test.ts`

```ts
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
```

- [ ] **Step 2: Run to verify fail**

Run: `npm run test -w encryptor -- config`
Expected: FAIL — cannot resolve `../src/config.js`.

- [ ] **Step 3: Write `encryptor/src/config.ts`**

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
};

const REQUIRED: (keyof EncryptorConfig)[] = [
  "webdavUrl",
  "webdavUser",
  "webdavPass",
  "passphrase",
  "sourceDir",
  "statePath",
];

export function loadConfig(opts: { fileJson?: PartialConfig; env: Record<string, string | undefined> }): EncryptorConfig {
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -w encryptor -- config`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add encryptor/src/config.ts encryptor/test/config.test.ts
git commit -m "feat(encryptor): config loader (file + env)"
```

---

### Task 7: CLI arg parsing + entry (`cli.ts`)

**Files:**
- Create: `encryptor/src/cli.ts`, `encryptor/test/cli.test.ts`

Design: `parseArgs(argv)` → `{ configPath, full, help }`. `main(argv)` reads config file (if present) + env, loads/inits state from `statePath`, builds `NodeSourceFs` + `FetchWebDav`, runs `encryptSync`, writes state back, prints stats. Test only the pure `parseArgs`; `main` wiring is exercised by the esbuild smoke test in Task 8.

- [ ] **Step 1: Write the failing test** — `encryptor/test/cli.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { parseArgs } from "../src/cli.js";

describe("parseArgs", () => {
  it("defaults: no full, config.json", () => {
    expect(parseArgs([])).toEqual({ configPath: "config.json", full: false, help: false });
  });
  it("--full sets full", () => {
    expect(parseArgs(["--full"]).full).toBe(true);
  });
  it("--config <path> sets configPath", () => {
    expect(parseArgs(["--config", "/etc/enc.json"]).configPath).toBe("/etc/enc.json");
  });
  it("--help sets help", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm run test -w encryptor -- cli`
Expected: FAIL — cannot resolve `../src/cli.js`.

- [ ] **Step 3: Write `encryptor/src/cli.ts`**

```ts
import { readFile, writeFile } from "node:fs/promises";
import { loadConfig } from "./config.js";
import { newState, parseState, serializeState } from "./state.js";
import { NodeSourceFs } from "./walk.js";
import { FetchWebDav } from "./webdav.js";
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

const HELP = `encryptor — encrypt a vault and sync it to WebDAV

Usage: node encryptor.mjs [--config <path>] [--full] [--help]

  --config <path>  Path to config.json (default: config.json)
  --full           Re-encrypt and re-upload every file, ignoring state
  --help, -h       Show this help

Config keys (overridable via env WEBDAV_URL/WEBDAV_USER/WEBDAV_PASS/PASSPHRASE/SOURCE_DIR/STATE_PATH):
  webdavUrl, webdavUser, webdavPass, passphrase, sourceDir, statePath, ignore[]
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
  const webdav = new FetchWebDav({
    baseUrl: config.webdavUrl,
    user: config.webdavUser,
    pass: config.webdavPass,
  });

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
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -w encryptor -- cli`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add encryptor/src/cli.ts encryptor/test/cli.test.ts
git commit -m "feat(encryptor): CLI arg parsing + main wiring"
```

---

### Task 8: esbuild single-file bundle + smoke test

**Files:**
- Create: `encryptor/src/main.ts` (entry that calls `main`), `encryptor/esbuild.config.mjs`

- [ ] **Step 1: Write `encryptor/src/main.ts`**

```ts
import { main } from "./cli.js";

main(process.argv.slice(2)).catch((err) => {
  process.stderr.write(`encryptor: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Write `encryptor/esbuild.config.mjs`**

```js
import { build } from "esbuild";

await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "encryptor.mjs",
  banner: { js: "#!/usr/bin/env node" },
});

console.log("Built encryptor.mjs");
```

- [ ] **Step 3: Build the bundle**

Run: `npm run build -w encryptor`
Expected: prints "Built encryptor.mjs"; `encryptor/encryptor.mjs` exists, single file.

- [ ] **Step 4: Smoke-test the bundle runs standalone (no node_modules needed)**

Run: `cd encryptor && node encryptor.mjs --help`
Expected: prints usage text (exercises the whole wiring, no crash).

- [ ] **Step 5: Verify it errors cleanly without config**

Run: `cd encryptor && node encryptor.mjs --config /nonexistent.json`
Expected: `encryptor: Missing required config: ...`, exit code 1.

- [ ] **Step 6: Add `encryptor/encryptor.mjs` to `.gitignore`** (build artifact)

Append to `.gitignore`:
```
encryptor/encryptor.mjs
```

- [ ] **Step 7: Commit**

```bash
git add encryptor/src/main.ts encryptor/esbuild.config.mjs .gitignore
git commit -m "build(encryptor): esbuild single-file bundle + smoke test"
```

---

### Task 9: Full suite + typecheck + docs

**Files:** Modify `CLAUDE.md`

- [ ] **Step 1: Run everything**

Run: `npm test && npm run typecheck`
Expected: crypto-core (24) + encryptor (~20) tests pass; both typechecks clean.

- [ ] **Step 2: Update `CLAUDE.md`** — mark M1 done, record encryptor build/test commands (`npm test -w encryptor`, `npm run build -w encryptor`, single-file deploy).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: mark M1 done, record encryptor commands"
```

---

## Self-review notes

- **Spec coverage:** §5.1 single-file bundle (Task 8), §5.1.1 fetch WebDAV (Task 3), §5.2 config (Task 6), §5.3 state+salt (Task 2), §5.4 algorithm incl. skip/delete/`--full`/manifest (Task 5), §5.5 run (Task 7/8).
- **Same crypto both sides:** encryptor imports `crypto-core` package → identical format to plugin; sync test decrypts the manifest with crypto-core to prove interop.
- **Testable core:** `encryptSync` depends only on `SourceFs`/`WebDav` ports; Node/fetch adapters are thin and covered by walker/webdav unit tests + the esbuild smoke test.
- **Type consistency:** `SyncState`, `SourceFile`, `SourceFs`, `WebDav`, `SyncStats`, `EncryptorConfig` defined once in `types.ts` and reused; `Bytes` from crypto-core used for all crypto buffers.
