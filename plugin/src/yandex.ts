import { utf8Decode } from "crypto-core";
import type { Bytes, ConditionalGet, RequestFn, WebDavClient } from "./types.js";

export const DEFAULT_YANDEX_API = "https://cloud-api.yandex.net/v1/disk";

export interface YandexClientOptions {
  token: string;
  remoteBase: string;
  request: RequestFn;
  /** REST base URL; defaults to the public Yandex.Disk API. */
  apiBase?: string;
}

export class YandexClient implements WebDavClient {
  private readonly token: string;
  private readonly base: string;
  private readonly api: string;
  private readonly request: RequestFn;

  constructor(opts: YandexClientOptions) {
    this.token = opts.token;
    this.base = opts.remoteBase.replace(/^\/+|\/+$/g, "");
    this.api = (opts.apiBase && opts.apiBase.trim() ? opts.apiBase : DEFAULT_YANDEX_API).replace(
      /\/+$/,
      "",
    );
    this.request = opts.request;
  }

  private auth(): Record<string, string> {
    return { Authorization: `OAuth ${this.token}` };
  }

  private diskPath(name: string): string {
    return this.base ? `disk:/${this.base}/${name}` : `disk:/${name}`;
  }

  private json(bytes: ArrayBuffer): unknown {
    return JSON.parse(utf8Decode(new Uint8Array(bytes)));
  }

  private async download(name: string): Promise<Bytes> {
    const meta = await this.request({
      url: `${this.api}/resources/download?path=${encodeURIComponent(this.diskPath(name))}`,
      method: "GET",
      headers: this.auth(),
      throw: false,
    });
    if (meta.status < 200 || meta.status >= 300) {
      throw new Error(`GET ${name} failed: ${meta.status}`);
    }
    const { href } = this.json(meta.arrayBuffer) as { href: string };
    const file = await this.request({ url: href, method: "GET", throw: false });
    if (file.status < 200 || file.status >= 300) {
      throw new Error(`GET ${name} failed: ${file.status}`);
    }
    return new Uint8Array(file.arrayBuffer);
  }

  async get(name: string): Promise<Bytes> {
    return this.download(name);
  }

  async getConditional(name: string, etag?: string): Promise<ConditionalGet> {
    const meta = await this.request({
      url: `${this.api}/resources?path=${encodeURIComponent(this.diskPath(name))}&fields=md5`,
      method: "GET",
      headers: this.auth(),
      throw: false,
    });
    if (meta.status < 200 || meta.status >= 300) {
      throw new Error(`GET ${name} failed: ${meta.status}`);
    }
    const md5 = (this.json(meta.arrayBuffer) as { md5?: string }).md5;
    if (etag && md5 === etag) return { status: 304 };
    const body = await this.download(name);
    return { status: 200, body, etag: md5 };
  }
}
