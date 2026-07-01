import type { Bytes, WebDav } from "./types.js";

export interface FetchWebDavOptions {
  baseUrl: string;
  user: string;
  pass: string;
  fetchFn?: typeof fetch;
}

export class FetchWebDav implements WebDav {
  private readonly base: string;
  private readonly auth: string;
  private readonly fetchFn: typeof fetch;

  constructor(opts: FetchWebDavOptions) {
    this.base = opts.baseUrl.replace(/\/+$/, "");
    this.auth = "Basic " + Buffer.from(`${opts.user}:${opts.pass}`).toString("base64");
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  private url(name: string): string {
    return `${this.base}/${name}`;
  }

  async put(name: string, body: Bytes): Promise<void> {
    const res = await this.fetchFn(this.url(name), {
      method: "PUT",
      headers: { Authorization: this.auth },
      body,
    });
    if (!res.ok) throw new Error(`PUT ${name} failed: ${res.status}`);
  }

  async del(name: string): Promise<void> {
    const res = await this.fetchFn(this.url(name), {
      method: "DELETE",
      headers: { Authorization: this.auth },
    });
    // 404 on delete is fine (already gone); other non-2xx throws.
    if (!res.ok && res.status !== 404) throw new Error(`DELETE ${name} failed: ${res.status}`);
  }
}
