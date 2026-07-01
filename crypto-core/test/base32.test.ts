import { describe, it, expect } from "vitest";
import { base32NoPadEncode } from "../src/base32.js";
import { utf8Encode } from "../src/bytes.js";

describe("base32NoPadEncode", () => {
  it("matches RFC 4648 vectors (lowercase, no padding)", () => {
    expect(base32NoPadEncode(utf8Encode(""))).toBe("");
    expect(base32NoPadEncode(utf8Encode("f"))).toBe("my");
    expect(base32NoPadEncode(utf8Encode("fo"))).toBe("mzxq");
    expect(base32NoPadEncode(utf8Encode("foo"))).toBe("mzxw6");
    expect(base32NoPadEncode(utf8Encode("foob"))).toBe("mzxw6yq");
    expect(base32NoPadEncode(utf8Encode("fooba"))).toBe("mzxw6ytb");
    expect(base32NoPadEncode(utf8Encode("foobar"))).toBe("mzxw6ytboi");
  });

  it("encodes 32 bytes to 52 chars", () => {
    expect(base32NoPadEncode(new Uint8Array(32)).length).toBe(52);
  });
});
