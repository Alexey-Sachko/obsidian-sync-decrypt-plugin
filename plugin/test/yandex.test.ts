import { describe, it, expect } from "vitest";
import { YandexClient } from "../src/yandex.js";
import type { RequestArg, RequestResponse } from "../src/types.js";

const enc = (obj: unknown): ArrayBuffer =>
  new TextEncoder().encode(JSON.stringify(obj)).buffer as ArrayBuffer;

function router(handlers: (arg: RequestArg) => RequestResponse) {
  const calls: RequestArg[] = [];
  const request = async (arg: RequestArg): Promise<RequestResponse> => {
    calls.push(arg);
    return handlers(arg);
  };
  return { calls, request };
}

describe("YandexClient.get", () => {
  it("resolves download href then fetches bytes", async () => {
    const { calls, request } = router((arg) => {
      if (arg.url.includes("/resources/download"))
        return { status: 200, arrayBuffer: enc({ href: "https://dl/get" }) };
      if (arg.url === "https://dl/get")
        return { status: 200, arrayBuffer: new Uint8Array([9, 8, 7]).buffer as ArrayBuffer };
      return { status: 500, arrayBuffer: new ArrayBuffer(0) };
    });
    const c = new YandexClient({ token: "T", remoteBase: "second-brain", request });
    const bytes = await c.get("blob1");
    expect(decodeURIComponent(calls[0]!.url)).toContain("path=disk:/second-brain/blob1");
    expect(calls[0]!.headers!["Authorization"]).toBe("OAuth T");
    expect([...bytes]).toEqual([9, 8, 7]);
  });

  it("uses a custom apiBase when provided (trailing slash trimmed)", async () => {
    const { calls, request } = router((arg) => {
      if (arg.url.includes("/resources/download"))
        return { status: 200, arrayBuffer: enc({ href: "https://dl/x" }) };
      return { status: 200, arrayBuffer: new Uint8Array([1]).buffer as ArrayBuffer };
    });
    const c = new YandexClient({
      token: "T",
      remoteBase: "",
      request,
      apiBase: "https://proxy.example/disk/",
    });
    await c.get("blob1");
    expect(calls[0]!.url).toContain("https://proxy.example/disk/resources/download");
    expect(calls[0]!.url).not.toContain("cloud-api.yandex.net");
  });

  it("falls back to the default endpoint when apiBase is empty", async () => {
    const { calls, request } = router((arg) => {
      if (arg.url.includes("/resources/download"))
        return { status: 200, arrayBuffer: enc({ href: "https://dl/x" }) };
      return { status: 200, arrayBuffer: new Uint8Array([1]).buffer as ArrayBuffer };
    });
    const c = new YandexClient({ token: "T", remoteBase: "", request, apiBase: "" });
    await c.get("blob1");
    expect(calls[0]!.url).toContain("https://cloud-api.yandex.net/v1/disk/resources/download");
  });
});

describe("YandexClient.getConditional", () => {
  it("returns 304 when md5 matches the stored etag", async () => {
    const { request } = router((arg) => {
      if (arg.url.includes("/resources?")) return { status: 200, arrayBuffer: enc({ md5: "abc" }) };
      return { status: 500, arrayBuffer: new ArrayBuffer(0) };
    });
    const c = new YandexClient({ token: "T", remoteBase: "", request });
    const res = await c.getConditional("manifest.enc", "abc");
    expect(res.status).toBe(304);
    expect(res.body).toBeUndefined();
  });

  it("downloads and returns md5 as etag when changed", async () => {
    const { request } = router((arg) => {
      if (arg.url.includes("/resources?")) return { status: 200, arrayBuffer: enc({ md5: "new" }) };
      if (arg.url.includes("/resources/download"))
        return { status: 200, arrayBuffer: enc({ href: "https://dl/m" }) };
      if (arg.url === "https://dl/m")
        return { status: 200, arrayBuffer: new Uint8Array([1]).buffer as ArrayBuffer };
      return { status: 500, arrayBuffer: new ArrayBuffer(0) };
    });
    const c = new YandexClient({ token: "T", remoteBase: "", request });
    const res = await c.getConditional("manifest.enc", "old");
    expect(res.status).toBe(200);
    expect([...res.body!]).toEqual([1]);
    expect(res.etag).toBe("new");
  });

  it("throws when the manifest metadata is 404", async () => {
    const { request } = router(() => ({ status: 404, arrayBuffer: new ArrayBuffer(0) }));
    const c = new YandexClient({ token: "T", remoteBase: "", request });
    await expect(c.getConditional("manifest.enc")).rejects.toThrow(/404/);
  });
});
