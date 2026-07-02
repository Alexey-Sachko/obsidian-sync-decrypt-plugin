import { describe, it, expect } from "vitest";
import { YandexWebDav } from "../src/yandex.js";

function recorder(handlers: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init: init ?? {} });
    return handlers(u, init ?? {});
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

describe("YandexWebDav", () => {
  it("put: ensures folder, gets upload href, PUTs body", async () => {
    const { calls, fetchFn } = recorder((url) => {
      if (url.includes("/resources/upload"))
        return new Response(JSON.stringify({ href: "https://up/put" }), { status: 200 });
      if (url === "https://up/put") return new Response(null, { status: 201 });
      if (url.includes("/resources?") || url.endsWith("/resources"))
        return new Response(null, { status: 201 }); // folder
      return new Response(null, { status: 500 });
    });
    const dav = new YandexWebDav({ token: "T", remoteBase: "second-brain", fetchFn });
    await dav.put("blob1", new Uint8Array([1, 2, 3]));

    const upload = calls.find((c) => c.url.includes("/resources/upload"))!;
    expect(decodeURIComponent(upload.url)).toContain("path=disk:/second-brain/blob1");
    expect(upload.url).toContain("overwrite=true");
    expect((upload.init.headers as Record<string, string>)["Authorization"]).toBe("OAuth T");
    const put = calls.find((c) => c.url === "https://up/put")!;
    expect(put.init.method).toBe("PUT");
  });

  it("del: DELETE resources with permanently=true, tolerates 404", async () => {
    const { calls, fetchFn } = recorder((url) => {
      if (url.includes("/resources?") && !url.includes("upload") && !url.includes("download"))
        return new Response(null, { status: 404 });
      return new Response(null, { status: 500 });
    });
    const dav = new YandexWebDav({ token: "T", remoteBase: "", fetchFn });
    await expect(dav.del("gone")).resolves.toBeUndefined();
    expect(decodeURIComponent(calls[0]!.url)).toContain("path=disk:/gone");
    expect(calls[0]!.init.method).toBe("DELETE");
  });

  it("put throws when upload href request fails", async () => {
    const { fetchFn } = recorder((url) => {
      if (url.endsWith("/resources") || (url.includes("/resources?") && !url.includes("upload")))
        return new Response(null, { status: 201 });
      if (url.includes("/resources/upload")) return new Response("no", { status: 403 });
      return new Response(null, { status: 500 });
    });
    const dav = new YandexWebDav({ token: "T", remoteBase: "x", fetchFn });
    await expect(dav.put("b", new Uint8Array([1]))).rejects.toThrow(/403/);
  });
});
