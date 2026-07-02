import { build } from "esbuild";
import builtins from "builtin-modules";

await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "browser",
  format: "cjs",
  target: "es2022",
  outfile: "main.js",
  external: ["obsidian", "electron", ...builtins],
  logLevel: "info",
});

console.log("Built main.js");
