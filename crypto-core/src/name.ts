import { base32NoPadEncode } from "./base32.js";
import { utf8Encode } from "./bytes.js";

export async function deriveName(nameKey: CryptoKey, realPath: string): Promise<string> {
  const mac = await crypto.subtle.sign("HMAC", nameKey, utf8Encode(realPath));
  return base32NoPadEncode(new Uint8Array(mac));
}
