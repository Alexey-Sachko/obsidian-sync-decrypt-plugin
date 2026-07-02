import { describe, it, expect } from "vitest";
import { ObsidianWebDavClient } from "../src/webdav.js";
import type { RequestArg, RequestResponse } from "../src/types.js";

function fakeRequest(status = 200, body = new Uint8Array([1, 2, 3])) {
  const calls: RequestArg[] = [];
  const fn = async (arg: RequestArg): Promise<RequestResponse> => {
    calls.push(arg);
    return { status, arrayBuffer: body.buffer.slice(0) as ArrayBuffer };
  };
  return { calls, fn };
}

describe("ObsidianWebDavClient", () => {
  it("GETs remoteBase/name with Basic auth, returns bytes", async () => {
    const { calls, fn } = fakeRequest();
    const dav = new ObsidianWebDavClient({
      baseUrl: "http://x/dav/",
      remoteBase: "vault",
      user: "u",
      pass: "p",
      request: fn,
    });
    const bytes = await dav.get("blob1");
    expect(calls[0]!.url).toBe("http://x/dav/vault/blob1");
    expect(calls[0]!.headers!["Authorization"]).toBe("Basic " + btoa("u:p"));
    expect([...bytes]).toEqual([1, 2, 3]);
  });

  it("joins without remoteBase", async () => {
    const { calls, fn } = fakeRequest();
    const dav = new ObsidianWebDavClient({
      baseUrl: "http://x/dav",
      remoteBase: "",
      user: "u",
      pass: "p",
      request: fn,
    });
    await dav.get("manifest.enc");
    expect(calls[0]!.url).toBe("http://x/dav/manifest.enc");
  });

  it("throws on non-2xx", async () => {
    const { fn } = fakeRequest(404);
    const dav = new ObsidianWebDavClient({
      baseUrl: "http://x",
      remoteBase: "",
      user: "u",
      pass: "p",
      request: fn,
    });
    await expect(dav.get("manifest.enc")).rejects.toThrow(/404/);
  });
});

describe("ObsidianWebDavClient.getConditional", () => {
  it("sends If-None-Match and returns body + etag on 200", async () => {
    const calls: RequestArg[] = [];
    const fn = async (arg: RequestArg): Promise<RequestResponse> => {
      calls.push(arg);
      return {
        status: 200,
        arrayBuffer: new Uint8Array([7, 8]).buffer.slice(0) as ArrayBuffer,
        headers: { ETag: '"abc"' },
      };
    };
    const dav = new ObsidianWebDavClient({
      baseUrl: "http://x",
      remoteBase: "",
      user: "u",
      pass: "p",
      request: fn,
    });
    const res = await dav.getConditional("manifest.enc", '"old"');
    expect(calls[0]!.headers!["If-None-Match"]).toBe('"old"');
    expect(res.status).toBe(200);
    expect([...res.body!]).toEqual([7, 8]);
    expect(res.etag).toBe('"abc"');
  });

  it("returns 304 with no body", async () => {
    const fn = async (): Promise<RequestResponse> => ({
      status: 304,
      arrayBuffer: new ArrayBuffer(0),
    });
    const dav = new ObsidianWebDavClient({
      baseUrl: "http://x",
      remoteBase: "",
      user: "u",
      pass: "p",
      request: fn,
    });
    const res = await dav.getConditional("manifest.enc", '"old"');
    expect(res.status).toBe(304);
    expect(res.body).toBeUndefined();
  });

  it("omits If-None-Match when no etag given", async () => {
    const calls: RequestArg[] = [];
    const fn = async (arg: RequestArg): Promise<RequestResponse> => {
      calls.push(arg);
      return { status: 200, arrayBuffer: new ArrayBuffer(0), headers: {} };
    };
    const dav = new ObsidianWebDavClient({
      baseUrl: "http://x",
      remoteBase: "",
      user: "u",
      pass: "p",
      request: fn,
    });
    await dav.getConditional("manifest.enc");
    expect(calls[0]!.headers!["If-None-Match"]).toBeUndefined();
  });
});
