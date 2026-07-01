const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

export function base32NoPadEncode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(value >>> bits) & 31];
    }
  }
  if (bits > 0) {
    out += ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}
