import { build } from "esbuild";

await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "encryptor.mjs",
  banner: { js: "#!/usr/bin/env node" },
});

console.log("Built encryptor.mjs");
