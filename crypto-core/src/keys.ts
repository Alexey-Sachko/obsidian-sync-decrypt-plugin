import { utf8Encode } from "./bytes.js";
import type { DerivedKeys } from "./types.js";

const PBKDF2_ITERATIONS = 200_000;
const EMPTY_SALT = new Uint8Array(0);

export async function deriveKeys(passphrase: string, salt: Uint8Array): Promise<DerivedKeys> {
  const passKey = await crypto.subtle.importKey(
    "raw",
    utf8Encode(passphrase),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const rootBits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    passKey,
    256,
  );

  const hkdfKey = await crypto.subtle.importKey("raw", rootBits, "HKDF", false, ["deriveKey"]);

  const contentKey = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: EMPTY_SALT, info: utf8Encode("content/v1") },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );

  const nameKey = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: EMPTY_SALT, info: utf8Encode("filename/v1") },
    hkdfKey,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"],
  );

  return { contentKey, nameKey, salt };
}
