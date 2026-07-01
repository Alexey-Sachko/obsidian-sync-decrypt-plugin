import { describe, it, expect } from "vitest";
import { deriveKeys } from "../src/keys.js";
import { deriveName } from "../src/name.js";

const salt = new Uint8Array(16).fill(7);

describe("deriveName", () => {
  it("is deterministic and base32 (52 chars, lowercase alnum)", async () => {
    const { nameKey } = await deriveKeys("pw", salt);
    const n1 = await deriveName(nameKey, "Notes/idea.md");
    const n2 = await deriveName(nameKey, "Notes/idea.md");
    expect(n1).toBe(n2);
    expect(n1).toMatch(/^[a-z2-7]{52}$/);
  });

  it("different paths produce different names", async () => {
    const { nameKey } = await deriveKeys("pw", salt);
    expect(await deriveName(nameKey, "a.md")).not.toBe(await deriveName(nameKey, "b.md"));
  });
});
