/**
 * A Uint8Array whose backing store is a plain ArrayBuffer (never a
 * SharedArrayBuffer). Web Crypto's `BufferSource` requires this; a bare
 * `Uint8Array` defaults to `Uint8Array<ArrayBufferLike>` under modern TS and is
 * rejected. Every byte value that flows into `crypto.subtle`/`TextDecoder` uses
 * this alias so the module typechecks identically on Node ≥ 20 and iOS WebView.
 */
export type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function utf8Encode(s: string): Bytes {
  return encoder.encode(s);
}

export function utf8Decode(b: Bytes): string {
  return decoder.decode(b);
}

export function concatBytes(...parts: Uint8Array[]): Bytes {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function toHex(b: Uint8Array): string {
  let s = "";
  for (const byte of b) s += byte.toString(16).padStart(2, "0");
  return s;
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
