import { describe, it, expect } from "vitest";
import { computeDiff } from "../src/diff.js";
import type { Manifest } from "crypto-core";
import type { PersistedState } from "../src/types.js";

const manifest: Manifest = {
  version: 1,
  generatedAt: "t",
  files: [
    { path: "a.md", name: "na", size: 1, sha256: "sha-a", mtime: 1 },
    { path: "b.md", name: "nb", size: 1, sha256: "sha-b-new", mtime: 1 },
  ],
};

describe("computeDiff", () => {
  it("downloads new and changed files, skips unchanged", () => {
    const state: PersistedState = {
      fileState: { "a.md": { sha256: "sha-a" }, "b.md": { sha256: "sha-b-old" } },
    };
    const diff = computeDiff(manifest, state, true);
    expect(diff.toDownload.map((f) => f.path)).toEqual(["b.md"]);
    expect(diff.toDelete).toEqual([]);
  });

  it("marks state paths absent from the manifest for deletion when deleteMissing", () => {
    const state: PersistedState = {
      fileState: { "a.md": { sha256: "sha-a" }, "old.md": { sha256: "x" } },
    };
    const diff = computeDiff(manifest, state, true);
    expect(diff.toDelete).toEqual(["old.md"]);
    expect(diff.toDownload.map((f) => f.path)).toEqual(["b.md"]);
  });

  it("never deletes when deleteMissing is false", () => {
    const state: PersistedState = { fileState: { "old.md": { sha256: "x" } } };
    const diff = computeDiff(manifest, state, false);
    expect(diff.toDelete).toEqual([]);
  });
});
