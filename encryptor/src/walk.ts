import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
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
    const abs = join(this.root, ...path.split("/"));
    return new Uint8Array(await readFile(abs));
  }
}
