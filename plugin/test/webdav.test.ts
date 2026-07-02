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
