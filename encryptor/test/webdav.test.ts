import { describe, it, expect } from "vitest";
import { FetchWebDav } from "../src/webdav.js";

function fakeFetch() {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(null, { status: 201 });
  };
  return { calls, fetchFn: fetchFn as unknown as typeof fetch };
}

describe("FetchWebDav", () => {
  it("PUTs to baseUrl/name with Basic auth and body", async () => {
    const { calls, fetchFn } = fakeFetch();
    const dav = new FetchWebDav({ baseUrl: "https://x/dav/", user: "u", pass: "p", fetchFn });
    await dav.put("blob1", new Uint8Array([1, 2, 3]));
    expect(calls[0]!.url).toBe("https://x/dav/blob1");
    expect(calls[0]!.init.method).toBe("PUT");
    const auth = (calls[0]!.init.headers as Record<string, string>)["Authorization"];
    expect(auth).toBe("Basic " + Buffer.from("u:p").toString("base64"));
  });

  it("DELETEs baseUrl/name", async () => {
    const { calls, fetchFn } = fakeFetch();
    const dav = new FetchWebDav({ baseUrl: "https://x/dav", user: "u", pass: "p", fetchFn });
    await dav.del("blob2");
    expect(calls[0]!.url).toBe("https://x/dav/blob2");
    expect(calls[0]!.init.method).toBe("DELETE");
  });

  it("throws on non-2xx", async () => {
    const fetchFn = (async () => new Response(null, { status: 500 })) as unknown as typeof fetch;
    const dav = new FetchWebDav({ baseUrl: "https://x", user: "u", pass: "p", fetchFn });
    await expect(dav.put("b", new Uint8Array([1]))).rejects.toThrow(/500/);
  });
});
