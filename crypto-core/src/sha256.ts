import { toHex, type Bytes } from "./bytes.js";

export async function sha256Hex(bytes: Bytes): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return toHex(new Uint8Array(digest));
}
