import { describe, it, expect } from "vitest";
import { utf8Encode, utf8Decode, concatBytes, toHex, equalBytes } from "../src/bytes.js";

describe("bytes", () => {
  it("utf8 round-trips including non-ascii", () => {
    const s = "Notes/idée.md";
    expect(utf8Decode(utf8Encode(s))).toBe(s);
  });

  it("concatBytes joins in order", () => {
    const out = concatBytes(new Uint8Array([1, 2]), new Uint8Array([3]));
    expect([...out]).toEqual([1, 2, 3]);
  });

  it("toHex is lowercase, zero-padded", () => {
    expect(toHex(new Uint8Array([0, 15, 255]))).toBe("000fff");
  });

  it("equalBytes is true only for identical content", () => {
    expect(equalBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(equalBytes(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(equalBytes(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
  });
});
