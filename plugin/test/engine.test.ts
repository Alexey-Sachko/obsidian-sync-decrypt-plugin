import { describe, it, expect } from "vitest";
import { SyncEngine } from "../src/engine.js";
import {
  deriveKeys,
  deriveName,
  encryptBlob,
  encryptManifest,
  sha256Hex,
  utf8Encode,
  utf8Decode,
  type Bytes,
  type Manifest,
} from "crypto-core";
import type {
  PersistedState,
  PluginSettings,
  StateStore,
  VaultWriter,
  WebDavClient,
} from "../src/types.js";

const SALT = new Uint8Array(16).fill(3) as Bytes;
const PASS = "engine-pass";

async function buildRemote(files: Record<string, string>) {
  const { contentKey, nameKey } = await deriveKeys(PASS, SALT);
  const blobs = new Map<string, Bytes>();
  const manifestFiles: Manifest["files"] = [];
  for (const [path, content] of Object.entries(files)) {
    const plain = utf8Encode(content);
    const name = await deriveName(nameKey, path);
    blobs.set(name, await encryptBlob(contentKey, plain));
    manifestFiles.push({
      path,
      name,
      size: plain.length,
      sha256: await sha256Hex(plain),
      mtime: 1,
    });
  }
  const manifest: Manifest = { version: 1, generatedAt: "t", files: manifestFiles };
  blobs.set("manifest.enc", await encryptManifest(manifest, SALT, contentKey));
  return blobs;
}

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

class FakeVault implements VaultWriter {
  written = new Map<string, string>();
  removed: string[] = [];
  async writeBinary(path: string, data: Bytes) {
    this.written.set(path, utf8Decode(data));
  }
  async remove(path: string) {
    this.removed.push(path);
  }
}

class FakeState implements StateStore {
  saves = 0;
  constructor(private state: PersistedState) {}
  get() {
    return this.state;
  }
  set(next: PersistedState) {
    this.state = next;
  }
  async save() {
    this.saves++;
  }
}

const settings = (over: Partial<PluginSettings> = {}): PluginSettings => ({
  webdavUrl: "http://x",
  webdavUser: "u",
  webdavPass: "p",
  passphrase: PASS,
  remoteBase: "",
  targetFolder: "",
  deleteMissing: true,
  syncInterval: 0,
  syncOnOpen: true,
  ...over,
});

const emptyState = (): PersistedState => ({ fileState: {} });

describe("SyncEngine.run", () => {
  it("downloads, decrypts, and writes all files on first run", async () => {
    const dav = new FakeDav(await buildRemote({ "a.md": "alpha", "Notes/b.md": "bravo" }));
    const vault = new FakeVault();
    const state = new FakeState(emptyState());
    const engine = new SyncEngine({ webdav: dav, vault, state, settings: settings() });

    const stats = await engine.run();

    expect(stats).toEqual({ downloaded: 2, failed: 0, deleted: 0 });
    expect(vault.written.get("a.md")).toBe("alpha");
    expect(vault.written.get("Notes/b.md")).toBe("bravo");
    expect(state.get().fileState["a.md"]!.sha256).toBe(await sha256Hex(utf8Encode("alpha")));
    expect(state.saves).toBe(1);
  });

  it("writes under targetFolder", async () => {
    const dav = new FakeDav(await buildRemote({ "a.md": "alpha" }));
    const vault = new FakeVault();
    const engine = new SyncEngine({
      webdav: dav,
      vault,
      state: new FakeState(emptyState()),
      settings: settings({ targetFolder: "Sync" }),
    });
    await engine.run();
    expect([...vault.written.keys()]).toEqual(["Sync/a.md"]);
  });

  it("skips unchanged files on the second run", async () => {
    const remote = await buildRemote({ "a.md": "alpha" });
    const state = new FakeState(emptyState());
    await new SyncEngine({
      webdav: new FakeDav(remote),
      vault: new FakeVault(),
      state,
      settings: settings(),
    }).run();

    const vault2 = new FakeVault();
    const stats2 = await new SyncEngine({
      webdav: new FakeDav(remote, new Set(), '"v2"'), // manifest changed, but file sha unchanged
      vault: vault2,
      state,
      settings: settings(),
    }).run();
    expect(stats2).toEqual({ downloaded: 0, failed: 0, deleted: 0 });
    expect(vault2.written.size).toBe(0);
  });

  it("counts a failed file, keeps its state unchanged, continues others", async () => {
    const remote = await buildRemote({ "a.md": "alpha", "bad.md": "bravo" });
    const { nameKey } = await deriveKeys(PASS, SALT);
    const badName = await deriveName(nameKey, "bad.md");
    const dav = new FakeDav(remote, new Set([badName]));
    const vault = new FakeVault();
    const state = new FakeState(emptyState());
    const stats = await new SyncEngine({ webdav: dav, vault, state, settings: settings() }).run();
    expect(stats.downloaded).toBe(1);
    expect(stats.failed).toBe(1);
    expect(vault.written.has("a.md")).toBe(true);
    expect(state.get().fileState["bad.md"]).toBeUndefined();
  });

  it("deletes vanished files when deleteMissing", async () => {
    const remote1 = await buildRemote({ "a.md": "alpha", "gone.md": "x" });
    const state = new FakeState(emptyState());
    await new SyncEngine({
      webdav: new FakeDav(remote1),
      vault: new FakeVault(),
      state,
      settings: settings(),
    }).run();

    const remote2 = await buildRemote({ "a.md": "alpha" });
    const vault2 = new FakeVault();
    const stats = await new SyncEngine({
      webdav: new FakeDav(remote2, new Set(), '"v2"'), // manifest changed (gone.md removed)
      vault: vault2,
      state,
      settings: settings(),
    }).run();
    expect(stats.deleted).toBe(1);
    expect(vault2.removed).toEqual(["gone.md"]);
    expect(state.get().fileState["gone.md"]).toBeUndefined();
  });

  it("stores the manifest etag and short-circuits on 304", async () => {
    const remote = await buildRemote({ "a.md": "alpha" });
    const dav = new FakeDav(remote);
    const state = new FakeState(emptyState());
    const r1 = await new SyncEngine({
      webdav: dav,
      vault: new FakeVault(),
      state,
      settings: settings(),
    }).run();
    expect(r1.notModified).toBeFalsy();
    expect(state.get().manifestEtag).toBe('"v1"');

    const dav2 = new FakeDav(remote); // same etag "v1"
    const vault2 = new FakeVault();
    const r2 = await new SyncEngine({
      webdav: dav2,
      vault: vault2,
      state,
      settings: settings(),
    }).run();
    expect(r2.notModified).toBe(true);
    expect(r2).toMatchObject({ downloaded: 0, failed: 0, deleted: 0 });
    expect(dav2.conditionalCalls).toEqual(['"v1"']);
    expect(vault2.written.size).toBe(0);
  });

  it("re-syncs when the etag changed", async () => {
    const remote1 = await buildRemote({ "a.md": "alpha" });
    const state = new FakeState(emptyState());
    await new SyncEngine({
      webdav: new FakeDav(remote1, new Set(), '"v1"'),
      vault: new FakeVault(),
      state,
      settings: settings(),
    }).run();

    const remote2 = await buildRemote({ "a.md": "alpha EDITED" });
    const dav2 = new FakeDav(remote2, new Set(), '"v2"');
    const vault2 = new FakeVault();
    const r2 = await new SyncEngine({
      webdav: dav2,
      vault: vault2,
      state,
      settings: settings(),
    }).run();
    expect(r2.notModified).toBeFalsy();
    expect(vault2.written.get("a.md")).toBe("alpha EDITED");
    expect(state.get().manifestEtag).toBe('"v2"');
  });

  it("reports progress after each download attempt", async () => {
    const dav = new FakeDav(await buildRemote({ "a.md": "alpha", "b.md": "bravo" }));
    const calls: Array<[number, number]> = [];
    const engine = new SyncEngine({
      webdav: dav,
      vault: new FakeVault(),
      state: new FakeState(emptyState()),
      settings: settings(),
      onProgress: (done, total) => calls.push([done, total]),
    });
    await engine.run();
    expect(calls).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it("throws on wrong passphrase before writing anything", async () => {
    const dav = new FakeDav(await buildRemote({ "a.md": "alpha" }));
    const vault = new FakeVault();
    const engine = new SyncEngine({
      webdav: dav,
      vault,
      state: new FakeState(emptyState()),
      settings: settings({ passphrase: "WRONG" }),
    });
    await expect(engine.run()).rejects.toThrow();
    expect(vault.written.size).toBe(0);
  });
});
