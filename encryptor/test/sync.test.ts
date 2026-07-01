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
    const source = new FakeSource(
      new Map([
        ["a.md", "alpha"],
        ["Notes/b.md", "bravo"],
      ]),
    );
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
    const r1 = await encryptSync({
      source,
      webdav: dav1,
      passphrase: "pw",
      state: newState(),
      now,
    });

    const dav2 = new FakeDav();
    const r2 = await encryptSync({
      source,
      webdav: dav2,
      passphrase: "pw",
      state: r1.state,
      now,
    });

    expect(r2.stats).toEqual({ uploaded: 0, skipped: 1, deleted: 0 });
    // only manifest re-PUT, no blob
    expect([...dav2.puts.keys()]).toEqual(["manifest.enc"]);
  });

  it("deletes vanished files and drops them from state", async () => {
    const source1 = new FakeSource(
      new Map([
        ["a.md", "alpha"],
        ["gone.md", "x"],
      ]),
    );
    const dav1 = new FakeDav();
    const r1 = await encryptSync({
      source: source1,
      webdav: dav1,
      passphrase: "pw",
      state: newState(),
      now,
    });
    const { nameKey } = await deriveKeys("pw", r1.state.salt);
    const goneName = await deriveName(nameKey, "gone.md");

    const source2 = new FakeSource(new Map([["a.md", "alpha"]]));
    const dav2 = new FakeDav();
    const r2 = await encryptSync({
      source: source2,
      webdav: dav2,
      passphrase: "pw",
      state: r1.state,
      now,
    });

    expect(r2.stats.deleted).toBe(1);
    expect(dav2.dels).toEqual([goneName]);
    expect(r2.state.files["gone.md"]).toBeUndefined();
  });

  it("--full re-uploads even unchanged files", async () => {
    const source = new FakeSource(new Map([["a.md", "alpha"]]));
    const r1 = await encryptSync({
      source,
      webdav: new FakeDav(),
      passphrase: "pw",
      state: newState(),
      now,
    });
    const dav2 = new FakeDav();
    const r2 = await encryptSync({
      source,
      webdav: dav2,
      passphrase: "pw",
      state: r1.state,
      full: true,
      now,
    });
    expect(r2.stats.uploaded).toBe(1);
  });
});
