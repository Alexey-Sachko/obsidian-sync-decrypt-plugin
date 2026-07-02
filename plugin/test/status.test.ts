import { describe, it, expect } from "vitest";
import { formatRelativeTime, statusText } from "../src/status.js";

const now = 1_000_000_000_000;

describe("formatRelativeTime", () => {
  it("just now under a minute", () => {
    expect(formatRelativeTime(now - 5_000, now)).toBe("just now");
  });
  it("minutes", () => {
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5m ago");
  });
  it("hours", () => {
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3h ago");
  });
  it("days", () => {
    expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe("2d ago");
  });
});

describe("statusText", () => {
  it("never synced", () => {
    expect(statusText({ kind: "idle" }, now)).toBe("Not synced yet");
  });
  it("syncing shows progress", () => {
    expect(statusText({ kind: "syncing", done: 12, total: 40 }, now)).toBe("Syncing… 12/40");
  });
  it("synced shows relative time", () => {
    expect(statusText({ kind: "synced", lastSync: now - 5 * 60_000 }, now)).toBe("Synced 5m ago");
  });
  it("failed", () => {
    expect(statusText({ kind: "failed" }, now)).toBe("Sync failed");
  });
});
