import { describe, it, expect } from "vitest";
import { PluginStateStore } from "../src/state-store.js";
import type { PersistedState } from "../src/types.js";

describe("PluginStateStore", () => {
  it("get returns the initial state", () => {
    const init: PersistedState = { fileState: { "a.md": { sha256: "x" } } };
    const store = new PluginStateStore(init, async () => {});
    expect(store.get()).toEqual(init);
  });

  it("save calls the persist callback with current state", async () => {
    let saved: PersistedState | undefined;
    const store = new PluginStateStore({ fileState: {} }, async (s) => {
      saved = s;
    });
    store.set({ fileState: { "b.md": { sha256: "y" } }, lastSync: 5 });
    await store.save();
    expect(saved).toEqual({ fileState: { "b.md": { sha256: "y" } }, lastSync: 5 });
  });
});
