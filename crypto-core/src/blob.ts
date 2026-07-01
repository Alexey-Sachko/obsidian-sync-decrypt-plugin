import { concatBytes, equalBytes, utf8Encode } from "./bytes.js";

const MAGIC = utf8Encode("OSD1"); // 4 bytes
const VERSION = 0x01;
const IV_LEN = 12;
const HEADER_LEN = 4 + 1 + IV_LEN;

export async function encryptBlob(
  contentKey: CryptoKey,
  plaintext: Uint8Array,
  iv: Uint8Array = crypto.getRandomValues(new Uint8Array(IV_LEN)),
): Promise<Uint8Array> {
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, contentKey, plaintext),
  );
  return concatBytes(MAGIC, new Uint8Array([VERSION]), iv, ct);
}

export async function decryptBlob(contentKey: CryptoKey, blob: Uint8Array): Promise<Uint8Array> {
  if (blob.length < HEADER_LEN) throw new Error("Blob too short");
  if (!equalBytes(blob.slice(0, 4), MAGIC)) throw new Error("Bad blob magic");
  if (blob[4] !== VERSION) throw new Error(`Unsupported blob version ${blob[4]}`);
  const iv = blob.slice(5, 5 + IV_LEN);
  const ct = blob.slice(HEADER_LEN);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, contentKey, ct);
  return new Uint8Array(plain);
}
