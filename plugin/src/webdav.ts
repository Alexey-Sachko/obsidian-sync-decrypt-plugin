import type { Bytes, ConditionalGet, RequestFn, WebDavClient } from "./types.js";

export interface ObsidianWebDavOptions {
  baseUrl: string;
  remoteBase: string;
  user: string;
  pass: string;
  request: RequestFn;
}

export class ObsidianWebDavClient implements WebDavClient {
  private readonly base: string;
  private readonly auth: string;
  private readonly request: RequestFn;

  constructor(opts: ObsidianWebDavOptions) {
    const root = opts.baseUrl.replace(/\/+$/, "");
    const sub = opts.remoteBase.replace(/^\/+|\/+$/g, "");
    this.base = sub ? `${root}/${sub}` : root;
    this.auth = "Basic " + btoa(`${opts.user}:${opts.pass}`);
    this.request = opts.request;
  }

  async get(name: string): Promise<Bytes> {
    const res = await this.request({
      url: `${this.base}/${name}`,
      method: "GET",
      headers: { Authorization: this.auth },
      throw: false,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`GET ${name} failed: ${res.status}`);
    }
    return new Uint8Array(res.arrayBuffer);
  }

  async getConditional(name: string, etag?: string): Promise<ConditionalGet> {
    const headers: Record<string, string> = { Authorization: this.auth };
    if (etag) headers["If-None-Match"] = etag;
    const res = await this.request({
      url: `${this.base}/${name}`,
      method: "GET",
      headers,
      throw: false,
    });
    if (res.status === 304) return { status: 304 };
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`GET ${name} failed: ${res.status}`);
    }
    const respEtag = res.headers?.["ETag"] ?? res.headers?.["etag"];
    return { status: 200, body: new Uint8Array(res.arrayBuffer), etag: respEtag };
  }
}
