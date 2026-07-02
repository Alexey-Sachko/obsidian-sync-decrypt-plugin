import { describe, it, expect } from "vitest";
import { ObsidianVaultWriter } from "../src/vault-writer.js";
import type { VaultAdapterLike } from "../src/types.js";

class FakeAdapter implements VaultAdapterLike {
  dirs = new Set<string>();
  files = new Map<string, ArrayBuffer>();
  removed: string[] = [];
  async mkdir(path: string) {
    if (this.dirs.has(path)) throw new Error("already exists");
    this.dirs.add(path);
  }
  async writeBinary(path: string, data: ArrayBuffer) {
    this.files.set(path, data);
  }
  async remove(path: string) {
    this.removed.push(path);
  }
  async exists(path: string) {
    return this.dirs.has(path) || this.files.has(path);
  }
}

describe("ObsidianVaultWriter", () => {
  it("creates ancestor dirs then writes the file", async () => {
    const a = new FakeAdapter();
    const w = new ObsidianVaultWriter(a);
    await w.writeBinary("Sync/Notes/a.md", new Uint8Array([1, 2]));
    expect(a.dirs.has("Sync")).toBe(true);
    expect(a.dirs.has("Sync/Notes")).toBe(true);
    expect(new Uint8Array(a.files.get("Sync/Notes/a.md")!)).toEqual(new Uint8Array([1, 2]));
  });

  it("tolerates existing dirs (no throw)", async () => {
    const a = new FakeAdapter();
    a.dirs.add("Sync");
    const w = new ObsidianVaultWriter(a);
    await expect(w.writeBinary("Sync/a.md", new Uint8Array([9]))).resolves.toBeUndefined();
  });

  it("writes a root file without mkdir", async () => {
    const a = new FakeAdapter();
    const w = new ObsidianVaultWriter(a);
    await w.writeBinary("a.md", new Uint8Array([1]));
    expect(a.dirs.size).toBe(0);
    expect(a.files.has("a.md")).toBe(true);
  });

  it("remove delegates to the adapter", async () => {
    const a = new FakeAdapter();
    const w = new ObsidianVaultWriter(a);
    await w.remove("a.md");
    expect(a.removed).toEqual(["a.md"]);
  });
});
