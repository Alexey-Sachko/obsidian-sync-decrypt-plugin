import { describe, it, expect } from "vitest";
import { parseState, serializeState, newState } from "../src/state.js";

describe("state", () => {
  it("newState makes a 16-byte salt and empty files", () => {
    const s = newState();
    expect(s.salt.length).toBe(16);
    expect(s.files).toEqual({});
  });

  it("round-trips through serialize/parse (salt preserved)", () => {
    const s = newState();
    s.files["a.md"] = { sha256: "de", name: "xyz", mtime: 5 };
    const json = serializeState(s);
    const back = parseState(json);
    expect([...back.salt]).toEqual([...s.salt]);
    expect(back.files).toEqual(s.files);
  });

  it("serialize writes salt as base64 string", () => {
    const s = newState();
    const parsed = JSON.parse(serializeState(s));
    expect(typeof parsed.salt).toBe("string");
    expect(Buffer.from(parsed.salt, "base64").length).toBe(16);
  });
});
