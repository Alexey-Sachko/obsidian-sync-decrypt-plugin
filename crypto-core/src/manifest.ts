import { concatBytes, equalBytes, utf8Decode, utf8Encode } from "./bytes.js";
import type { Manifest } from "./types.js";

const MAGIC = utf8Encode("OSDM");
const VERSION = 0x01;
const SALT_LEN = 16;
const IV_LEN = 12;
const SALT_OFFSET = 5;
const IV_OFFSET = SALT_OFFSET + SALT_LEN; // 21
const BODY_OFFSET = IV_OFFSET + IV_LEN; // 33

export function readManifestSalt(bytes: Uint8Array): Uint8Array {
  if (bytes.length < BODY_OFFSET) throw new Error("Manifest too short");
  if (!equalBytes(bytes.slice(0, 4), MAGIC)) throw new Error("Bad manifest magic");
  if (bytes[4] !== VERSION) throw new Error(`Unsupported manifest version ${bytes[4]}`);
  return bytes.slice(SALT_OFFSET, SALT_OFFSET + SALT_LEN);
}

export async function encryptManifest(
  manifest: Manifest,
  salt: Uint8Array,
  contentKey: CryptoKey,
  iv: Uint8Array = crypto.getRandomValues(new Uint8Array(IV_LEN)),
): Promise<Uint8Array> {
  if (salt.length !== SALT_LEN) throw new Error("Salt must be 16 bytes");
  const body = utf8Encode(JSON.stringify(manifest));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, contentKey, body));
  return concatBytes(MAGIC, new Uint8Array([VERSION]), salt, iv, ct);
}

export async function decryptManifest(bytes: Uint8Array, contentKey: CryptoKey): Promise<Manifest> {
  readManifestSalt(bytes); // validates magic/version/length
  const iv = bytes.slice(IV_OFFSET, IV_OFFSET + IV_LEN);
  const ct = bytes.slice(BODY_OFFSET);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, contentKey, ct);
  return JSON.parse(utf8Decode(new Uint8Array(plain))) as Manifest;
}
