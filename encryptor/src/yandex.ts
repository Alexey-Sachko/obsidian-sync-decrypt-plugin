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
