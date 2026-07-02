import type { Bytes, VaultAdapterLike, VaultWriter } from "./types.js";

export class ObsidianVaultWriter implements VaultWriter {
  constructor(private readonly adapter: VaultAdapterLike) {}

  async writeBinary(path: string, data: Bytes): Promise<void> {
    await this.ensureParentDirs(path);
    const buf = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    ) as ArrayBuffer;
    await this.adapter.writeBinary(path, buf);
  }

  async remove(path: string): Promise<void> {
    await this.adapter.remove(path);
  }

  private async ensureParentDirs(path: string): Promise<void> {
    const segments = path.split("/");
    segments.pop(); // drop filename
    let prefix = "";
    for (const seg of segments) {
      prefix = prefix ? `${prefix}/${seg}` : seg;
      try {
        await this.adapter.mkdir(prefix);
      } catch {
        // dir already exists — fine
      }
    }
  }
}
