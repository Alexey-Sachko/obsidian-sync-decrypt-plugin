export type SyncPhase =
  | { kind: "idle" }
  | { kind: "syncing"; done: number; total: number }
  | { kind: "synced"; lastSync: number }
  | { kind: "failed" };

export function formatRelativeTime(then: number, now: number): string {
  const sec = Math.max(0, Math.floor((now - then) / 1000));
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86_400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86_400)}d ago`;
}

export function statusText(phase: SyncPhase, now: number): string {
  switch (phase.kind) {
    case "idle":
      return "Not synced yet";
    case "syncing":
      return `Syncing… ${phase.done}/${phase.total}`;
    case "synced":
      return `Synced ${formatRelativeTime(phase.lastSync, now)}`;
    case "failed":
      return "Sync failed";
  }
}
