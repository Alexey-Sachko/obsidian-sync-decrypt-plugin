import { describe, it, expect } from "vitest";
import { parseArgs } from "../src/cli.js";

describe("parseArgs", () => {
  it("defaults: no full, config.json", () => {
    expect(parseArgs([])).toEqual({ configPath: "config.json", full: false, help: false });
  });
  it("--full sets full", () => {
    expect(parseArgs(["--full"]).full).toBe(true);
  });
  it("--config <path> sets configPath", () => {
    expect(parseArgs(["--config", "/etc/enc.json"]).configPath).toBe("/etc/enc.json");
  });
  it("--help sets help", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
  });
});
