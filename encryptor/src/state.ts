import type { SyncState } from "./types.js";

export function newState(): SyncState {
  return { salt: crypto.getRandomValues(new Uint8Array(16)), files: {} };
}

export function serializeState(state: SyncState): string {
  return JSON.stringify(
    { salt: Buffer.from(state.salt).toString("base64"), files: state.files },
    null,
    2,
  );
}

export function parseState(json: string): SyncState {
  const raw = JSON.parse(json) as { salt: string; files: SyncState["files"] };
  return {
    salt: new Uint8Array(Buffer.from(raw.salt, "base64")),
    files: raw.files ?? {},
  };
}
