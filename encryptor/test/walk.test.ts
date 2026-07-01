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
