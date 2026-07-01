import { main } from "./cli.js";

main(process.argv.slice(2)).catch((err) => {
  process.stderr.write(`encryptor: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
