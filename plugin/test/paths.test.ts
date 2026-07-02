import { describe, it, expect } from "vitest";
import { joinVaultPath } from "../src/paths.js";

describe("joinVaultPath", () => {
  it("returns the relative path when targetFolder is empty", () => {
    expect(joinVaultPath("", "Notes/a.md")).toBe("Notes/a.md");
  });
  it("joins targetFolder and relative path with a single slash", () => {
    expect(joinVaultPath("Sync", "Notes/a.md")).toBe("Sync/Notes/a.md");
  });
  it("normalizes surrounding slashes on targetFolder", () => {
    expect(joinVaultPath("/Sync/", "a.md")).toBe("Sync/a.md");
  });
  it("strips a leading slash from the relative path", () => {
    expect(joinVaultPath("Sync", "/a.md")).toBe("Sync/a.md");
  });
});
