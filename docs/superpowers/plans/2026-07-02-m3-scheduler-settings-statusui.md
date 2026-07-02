# M3 · Scheduler + Settings + StatusUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the plugin usable day-to-day: interval + sync-on-open scheduling (honoring iOS's no-background-sync limit), a full settings tab with validation and a Test-connection button, live status (status bar + ribbon spinner + Notices with progress), and a Reset-local-state command.

**Architecture:** Every decision remains in pure, injected units so it stays testable in Node/Vitest: interval preset → ms mapping, relative-time + status-text formatting, a `Scheduler` over injected timer functions, settings validation, and a `testConnection` over the existing `WebDavClient` port. `SyncEngine` gains an optional `onProgress(done,total)` hook. Only the thin runtime glue (`status-ui.ts`, the rewritten `settings.ts`/`main.ts`) touches Obsidian and is verified by typecheck + esbuild build.

**Tech Stack:** TypeScript 6, Obsidian API, Vitest, esbuild. Builds on M2.

---

## iOS constraints (must stay honest in UX)

- **No background sync.** Interval timer only fires while the app is foregrounded; `sync-on-open` runs at layout-ready. The settings copy must say this explicitly.
- Still `requestUrl()` only, no `Buffer`/`node:*`, DOM lib.

## Locked decisions

- **Settings additions:** `syncInterval: number` (minutes; `0` = Off; presets 0/5/15/30/60), `syncOnOpen: boolean` (default true).
- **Interval mapping:** `intervalToMs(0) = null` (off); otherwise `minutes * 60_000`.
- **Relative time:** `<60s` → "just now", `<60m` → "Nm ago", `<24h` → "Nh ago", else "Nd ago".
- **Status text:** idle/never → "Not synced yet"; syncing → "Syncing… done/total"; synced → "Synced <rel>"; failed → "Sync failed".
- **Test connection:** succeeds iff `webdav.get("manifest.enc")` resolves; otherwise returns the error message.
- **Reset local state:** clears `fileState` (and `lastSync`) and persists → next sync re-downloads everything.
- **Progress:** `SyncEngine` calls `onProgress(processed, total)` after each download attempt (success or failure).

## File structure

- `plugin/src/interval.ts` — `INTERVAL_PRESETS`, `intervalToMs`.
- `plugin/src/status.ts` — `SyncPhase`, `formatRelativeTime`, `statusText`.
- `plugin/src/scheduler.ts` — `Timers`, `Scheduler`.
- `plugin/src/validate.ts` — `validateSettings`, `testConnection`.
- `plugin/src/engine.ts` — add optional `onProgress` (modify).
- `plugin/src/types.ts` — add `syncInterval`, `syncOnOpen` (modify).
- `plugin/src/status-ui.ts` — runtime status bar + ribbon wrapper (thin).
- `plugin/src/settings.ts` — full settings tab (rewrite).
- `plugin/src/main.ts` — wire scheduler, sync-on-open, status, ribbon, reset command, progress (rewrite).
- `plugin/test/{interval,status,scheduler,validate}.test.ts` + engine test update.

---

### Task 1: Settings fields + interval mapping (`interval.ts`, `types.ts`)

**Files:**
- Modify: `plugin/src/types.ts`
- Create: `plugin/src/interval.ts`, `plugin/test/interval.test.ts`

- [ ] **Step 1: Add fields to `PluginSettings` in `plugin/src/types.ts`** — after `deleteMissing: boolean;` add:

```ts
  syncInterval: number; // minutes; 0 = off
  syncOnOpen: boolean;
```

- [ ] **Step 2: Write the failing test** — `plugin/test/interval.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { intervalToMs, INTERVAL_PRESETS } from "../src/interval.js";

describe("intervalToMs", () => {
  it("returns null for Off (0)", () => {
    expect(intervalToMs(0)).toBeNull();
  });
  it("converts minutes to ms", () => {
    expect(intervalToMs(5)).toBe(300000);
    expect(intervalToMs(60)).toBe(3600000);
  });
  it("treats negative/invalid as off", () => {
    expect(intervalToMs(-1)).toBeNull();
  });
  it("exposes the preset list including Off", () => {
    expect(INTERVAL_PRESETS.map((p) => p.minutes)).toEqual([0, 5, 15, 30, 60]);
    expect(INTERVAL_PRESETS[0]!.label).toBe("Off");
  });
});
```

- [ ] **Step 3: Run to verify fail**

Run: `npm test -w plugin -- interval`
Expected: FAIL — cannot resolve `../src/interval.js`.

- [ ] **Step 4: Write `plugin/src/interval.ts`**

```ts
export interface IntervalPreset {
  minutes: number;
  label: string;
}

export const INTERVAL_PRESETS: IntervalPreset[] = [
  { minutes: 0, label: "Off" },
  { minutes: 5, label: "Every 5 minutes" },
  { minutes: 15, label: "Every 15 minutes" },
  { minutes: 30, label: "Every 30 minutes" },
  { minutes: 60, label: "Every hour" },
];

export function intervalToMs(minutes: number): number | null {
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return minutes * 60_000;
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npm test -w plugin -- interval`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add plugin/src/interval.ts plugin/src/types.ts plugin/test/interval.test.ts
git commit -m "feat(plugin): interval presets + settings fields"
```

---

### Task 2: Status formatting (`status.ts`)

**Files:**
- Create: `plugin/src/status.ts`, `plugin/test/status.test.ts`

- [ ] **Step 1: Write the failing test** — `plugin/test/status.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { formatRelativeTime, statusText } from "../src/status.js";

const now = 1_000_000_000_000;

describe("formatRelativeTime", () => {
  it("just now under a minute", () => {
    expect(formatRelativeTime(now - 5_000, now)).toBe("just now");
  });
  it("minutes", () => {
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5m ago");
  });
  it("hours", () => {
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3h ago");
  });
  it("days", () => {
    expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe("2d ago");
  });
});

describe("statusText", () => {
  it("never synced", () => {
    expect(statusText({ kind: "idle" }, now)).toBe("Not synced yet");
  });
  it("syncing shows progress", () => {
    expect(statusText({ kind: "syncing", done: 12, total: 40 }, now)).toBe("Syncing… 12/40");
  });
  it("synced shows relative time", () => {
    expect(statusText({ kind: "synced", lastSync: now - 5 * 60_000 }, now)).toBe("Synced 5m ago");
  });
  it("failed", () => {
    expect(statusText({ kind: "failed" }, now)).toBe("Sync failed");
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -w plugin -- status`
Expected: FAIL — cannot resolve `../src/status.js`.

- [ ] **Step 3: Write `plugin/src/status.ts`**

```ts
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -w plugin -- status`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add plugin/src/status.ts plugin/test/status.test.ts
git commit -m "feat(plugin): status + relative-time formatting"
```

---

### Task 3: Scheduler (`scheduler.ts`)

**Files:**
- Create: `plugin/src/scheduler.ts`, `plugin/test/scheduler.test.ts`

- [ ] **Step 1: Write the failing test** — `plugin/test/scheduler.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { Scheduler, type Timers } from "../src/scheduler.js";

function fakeTimers() {
  let nextId = 1;
  const active = new Map<number, { cb: () => void; ms: number }>();
  const timers: Timers = {
    setInterval(cb, ms) {
      const id = nextId++;
      active.set(id, { cb, ms });
      return id;
    },
    clearInterval(id) {
      active.delete(id);
    },
  };
  return { timers, active };
}

describe("Scheduler", () => {
  it("does not schedule when interval is Off", () => {
    const { timers, active } = fakeTimers();
    const s = new Scheduler(timers, () => {});
    s.start(0);
    expect(active.size).toBe(0);
    expect(s.isRunning).toBe(false);
  });

  it("schedules at the interval and fires the callback", () => {
    const { timers, active } = fakeTimers();
    let runs = 0;
    const s = new Scheduler(timers, () => {
      runs++;
    });
    s.start(5);
    expect(active.size).toBe(1);
    const entry = [...active.values()][0]!;
    expect(entry.ms).toBe(300000);
    entry.cb();
    expect(runs).toBe(1);
  });

  it("start replaces any previous timer", () => {
    const { timers, active } = fakeTimers();
    const s = new Scheduler(timers, () => {});
    s.start(5);
    s.start(15);
    expect(active.size).toBe(1);
    expect([...active.values()][0]!.ms).toBe(900000);
  });

  it("stop clears the timer", () => {
    const { timers, active } = fakeTimers();
    const s = new Scheduler(timers, () => {});
    s.start(5);
    s.stop();
    expect(active.size).toBe(0);
    expect(s.isRunning).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -w plugin -- scheduler`
Expected: FAIL — cannot resolve `../src/scheduler.js`.

- [ ] **Step 3: Write `plugin/src/scheduler.ts`**

```ts
import { intervalToMs } from "./interval.js";

export interface Timers {
  setInterval(cb: () => void, ms: number): number;
  clearInterval(id: number): void;
}

export class Scheduler {
  private id: number | null = null;

  constructor(
    private readonly timers: Timers,
    private readonly run: () => void,
  ) {}

  start(intervalMinutes: number): void {
    this.stop();
    const ms = intervalToMs(intervalMinutes);
    if (ms !== null) {
      this.id = this.timers.setInterval(() => this.run(), ms);
    }
  }

  stop(): void {
    if (this.id !== null) {
      this.timers.clearInterval(this.id);
      this.id = null;
    }
  }

  get isRunning(): boolean {
    return this.id !== null;
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -w plugin -- scheduler`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add plugin/src/scheduler.ts plugin/test/scheduler.test.ts
git commit -m "feat(plugin): interval scheduler"
```

---

### Task 4: Validation + test connection (`validate.ts`)

**Files:**
- Create: `plugin/src/validate.ts`, `plugin/test/validate.test.ts`

- [ ] **Step 1: Write the failing test** — `plugin/test/validate.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { validateSettings, testConnection } from "../src/validate.js";
import type { PluginSettings, WebDavClient } from "../src/types.js";
import type { Bytes } from "crypto-core";

const ok: PluginSettings = {
  webdavUrl: "https://x",
  webdavUser: "u",
  webdavPass: "p",
  passphrase: "pw",
  remoteBase: "",
  targetFolder: "",
  deleteMissing: true,
  syncInterval: 0,
  syncOnOpen: true,
};

describe("validateSettings", () => {
  it("no errors for a complete config", () => {
    expect(validateSettings(ok)).toEqual([]);
  });
  it("flags empty URL and passphrase", () => {
    const errs = validateSettings({ ...ok, webdavUrl: "", passphrase: "" });
    expect(errs).toContain("WebDAV URL is required");
    expect(errs).toContain("Passphrase is required");
  });
});

describe("testConnection", () => {
  it("ok when manifest fetch resolves", async () => {
    const dav: WebDavClient = { get: async () => new Uint8Array([1]) as Bytes };
    expect(await testConnection(dav)).toEqual({ ok: true });
  });
  it("returns the error message on failure", async () => {
    const dav: WebDavClient = {
      get: async () => {
        throw new Error("GET manifest.enc failed: 401");
      },
    };
    const res = await testConnection(dav);
    expect(res.ok).toBe(false);
    expect(res.ok ? "" : res.message).toMatch(/401/);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -w plugin -- validate`
Expected: FAIL — cannot resolve `../src/validate.js`.

- [ ] **Step 3: Write `plugin/src/validate.ts`**

```ts
import type { PluginSettings, WebDavClient } from "./types.js";

export function validateSettings(s: PluginSettings): string[] {
  const errors: string[] = [];
  if (!s.webdavUrl.trim()) errors.push("WebDAV URL is required");
  if (!s.passphrase) errors.push("Passphrase is required");
  return errors;
}

export type ConnectionResult = { ok: true } | { ok: false; message: string };

export async function testConnection(webdav: WebDavClient): Promise<ConnectionResult> {
  try {
    await webdav.get("manifest.enc");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -w plugin -- validate`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add plugin/src/validate.ts plugin/test/validate.test.ts
git commit -m "feat(plugin): settings validation + test connection"
```

---

### Task 5: Engine progress hook (`engine.ts`)

**Files:**
- Modify: `plugin/src/engine.ts`, `plugin/test/engine.test.ts`

- [ ] **Step 1: Add a failing test** — append to `plugin/test/engine.test.ts` inside the `describe("SyncEngine.run")` block:

```ts
  it("reports progress after each download attempt", async () => {
    const dav = new FakeDav(await buildRemote({ "a.md": "alpha", "b.md": "bravo" }));
    const calls: Array<[number, number]> = [];
    const engine = new SyncEngine({
      webdav: dav,
      vault: new FakeVault(),
      state: new FakeState(emptyState()),
      settings: settings(),
      onProgress: (done, total) => calls.push([done, total]),
    });
    await engine.run();
    expect(calls).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -w plugin -- engine`
Expected: FAIL — `onProgress` not accepted / never called.

- [ ] **Step 3: Modify `plugin/src/engine.ts`** — add `onProgress` to deps and call it. In `SyncEngineDeps` add:

```ts
  onProgress?: (done: number, total: number) => void;
```

Replace the download loop with a progress-aware version:

```ts
    const total = toDownload.length;
    let processed = 0;
    for (const file of toDownload) {
      try {
        const blob = await webdav.get(file.name);
        const plain = await decryptBlob(contentKey, blob);
        await vault.writeBinary(joinVaultPath(settings.targetFolder, file.path), plain);
        current.fileState[file.path] = { sha256: file.sha256 };
        stats.downloaded++;
      } catch {
        // Per-file failure: leave state untouched so the file retries next sync.
        stats.failed++;
      }
      processed++;
      this.deps.onProgress?.(processed, total);
    }
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -w plugin -- engine`
Expected: PASS (all engine tests incl. new one).

- [ ] **Step 5: Commit**

```bash
git add plugin/src/engine.ts plugin/test/engine.test.ts
git commit -m "feat(plugin): engine progress callback"
```

---

### Task 6: Runtime StatusUI (`status-ui.ts`)

**Files:**
- Create: `plugin/src/status-ui.ts`

Thin runtime wrapper (no unit test; verified by typecheck + build). Holds a status bar element + optional ribbon element and renders `statusText`.

- [ ] **Step 1: Write `plugin/src/status-ui.ts`**

```ts
import { statusText, type SyncPhase } from "./status.js";

export class StatusUI {
  private phase: SyncPhase;

  constructor(
    private readonly statusBarEl: HTMLElement,
    lastSync?: number,
  ) {
    this.phase = lastSync ? { kind: "synced", lastSync } : { kind: "idle" };
    this.render();
  }

  setSyncing(done: number, total: number): void {
    this.phase = { kind: "syncing", done, total };
    this.render();
  }

  setSynced(lastSync: number): void {
    this.phase = { kind: "synced", lastSync };
    this.render();
  }

  setFailed(): void {
    this.phase = { kind: "failed" };
    this.render();
  }

  /** Refresh relative-time text (e.g. on a light interval) without changing phase. */
  refresh(): void {
    this.render();
  }

  private render(): void {
    this.statusBarEl.setText(`⇩ ${statusText(this.phase, Date.now())}`);
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck -w plugin`
Expected: no errors. (`HTMLElement.setText` is Obsidian's augmentation; DOM lib + obsidian types cover it. If `setText` is unresolved, use `this.statusBarEl.textContent = ...`.)

- [ ] **Step 3: Commit**

```bash
git add plugin/src/status-ui.ts
git commit -m "feat(plugin): runtime status bar UI"
```

---

### Task 7: Full settings tab + main wiring (`settings.ts`, `main.ts`)

**Files:**
- Rewrite: `plugin/src/settings.ts`, `plugin/src/main.ts`

Runtime only — verified by typecheck + build.

- [ ] **Step 1: Rewrite `plugin/src/settings.ts`** — add interval dropdown, syncOnOpen toggle, Test-connection button with inline result, and a validation summary.

```ts
import { PluginSettingTab, Setting } from "obsidian";
import type WebDavDecryptSyncPlugin from "./main.js";
import type { PluginSettings } from "./types.js";
import { INTERVAL_PRESETS } from "./interval.js";
import { validateSettings, testConnection } from "./validate.js";
import { ObsidianWebDavClient } from "./webdav.js";

export const DEFAULT_SETTINGS: PluginSettings = {
  webdavUrl: "",
  webdavUser: "",
  webdavPass: "",
  passphrase: "",
  remoteBase: "",
  targetFolder: "",
  deleteMissing: true,
  syncInterval: 0,
  syncOnOpen: true,
};

const STRING_KEYS = [
  "webdavUrl",
  "webdavUser",
  "webdavPass",
  "passphrase",
  "remoteBase",
  "targetFolder",
] as const;
type StringKey = (typeof STRING_KEYS)[number];

export class SyncSettingsTab extends PluginSettingTab {
  constructor(private readonly plugin: WebDavDecryptSyncPlugin) {
    super(plugin.app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;

    const textField = (name: string, desc: string, key: StringKey, password = false): void => {
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addText((t) => {
          t.setValue(s[key]).onChange(async (v) => {
            s[key] = v;
            await this.plugin.saveSettings();
          });
          if (password) t.inputEl.type = "password";
        });
    };

    textField("WebDAV URL", "Base URL of the WebDAV server", "webdavUrl");
    textField("Username", "WebDAV user", "webdavUser");
    textField("Password", "WebDAV password", "webdavPass", true);
    textField("Passphrase", "Decryption passphrase (same as the encryptor)", "passphrase", true);
    textField("Remote base", "Subpath on the server (optional)", "remoteBase");
    textField("Target folder", "Vault folder to write into (default: root)", "targetFolder");

    new Setting(containerEl)
      .setName("Delete missing files")
      .setDesc("Remove local files no longer present in the manifest")
      .addToggle((t) =>
        t.setValue(s.deleteMissing).onChange(async (v) => {
          s.deleteMissing = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Sync interval")
      .setDesc("Runs only while Obsidian is open — iOS has no background sync")
      .addDropdown((d) => {
        for (const p of INTERVAL_PRESETS) d.addOption(String(p.minutes), p.label);
        d.setValue(String(s.syncInterval)).onChange(async (v) => {
          s.syncInterval = Number(v);
          await this.plugin.saveSettings();
          this.plugin.applySchedule();
        });
      });

    new Setting(containerEl)
      .setName("Sync on open")
      .setDesc("Sync once when Obsidian finishes loading")
      .addToggle((t) =>
        t.setValue(s.syncOnOpen).onChange(async (v) => {
          s.syncOnOpen = v;
          await this.plugin.saveSettings();
        }),
      );

    const status = containerEl.createEl("p", { text: "" });
    status.style.opacity = "0.8";

    new Setting(containerEl)
      .setName("Test connection")
      .setDesc("Check URL, credentials, and that manifest.enc is reachable")
      .addButton((b) =>
        b.setButtonText("Test").onClick(async () => {
          const errs = validateSettings(s);
          if (errs.length) {
            status.setText("⚠ " + errs.join("; "));
            return;
          }
          status.setText("Testing…");
          const dav = new ObsidianWebDavClient({
            baseUrl: s.webdavUrl,
            remoteBase: s.remoteBase,
            user: s.webdavUser,
            pass: s.webdavPass,
            request: this.plugin.makeRequest(),
          });
          const res = await testConnection(dav);
          status.setText(res.ok ? "✓ Connection OK" : "✗ " + res.message);
        }),
      );

    new Setting(containerEl)
      .setName("Sync now")
      .addButton((b) => b.setButtonText("Sync now").setCta().onClick(() => void this.plugin.syncNow()));
  }
}
```

- [ ] **Step 2: Rewrite `plugin/src/main.ts`** — scheduler, sync-on-open, status bar, ribbon, reset command, progress wiring, and a shared `makeRequest()`.

```ts
import { Notice, Plugin, requestUrl } from "obsidian";
import type { PersistedState, PluginSettings, RequestFn } from "./types.js";
import { DEFAULT_SETTINGS, SyncSettingsTab } from "./settings.js";
import { ObsidianWebDavClient } from "./webdav.js";
import { ObsidianVaultWriter } from "./vault-writer.js";
import { PluginStateStore } from "./state-store.js";
import { SyncEngine } from "./engine.js";
import { Scheduler } from "./scheduler.js";
import { StatusUI } from "./status-ui.js";

interface StoredData {
  settings: PluginSettings;
  state: PersistedState;
}

export default class WebDavDecryptSyncPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  private state: PersistedState = { fileState: {} };
  private scheduler!: Scheduler;
  private status!: StatusUI;
  private syncing = false;

  async onload(): Promise<void> {
    await this.loadStored();

    this.status = new StatusUI(this.addStatusBarItem(), this.state.lastSync);
    this.scheduler = new Scheduler(
      {
        setInterval: (cb, ms) => window.setInterval(cb, ms),
        clearInterval: (id) => window.clearInterval(id),
      },
      () => void this.syncNow(),
    );

    this.addRibbonIcon("refresh-cw", "Sync now (WebDAV Decrypt)", () => void this.syncNow());

    this.addCommand({ id: "sync-now", name: "Sync now", callback: () => void this.syncNow() });
    this.addCommand({
      id: "reset-sync-state",
      name: "Reset local sync state",
      callback: () => void this.resetState(),
    });

    this.addSettingTab(new SyncSettingsTab(this));

    this.app.workspace.onLayoutReady(() => {
      this.applySchedule();
      if (this.settings.syncOnOpen) void this.syncNow();
    });
  }

  onunload(): void {
    this.scheduler?.stop();
  }

  makeRequest(): RequestFn {
    return async (arg) => {
      const res = await requestUrl({
        url: arg.url,
        method: arg.method,
        headers: arg.headers,
        throw: false,
      });
      return { status: res.status, arrayBuffer: res.arrayBuffer };
    };
  }

  applySchedule(): void {
    this.scheduler.start(this.settings.syncInterval);
  }

  async syncNow(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const webdav = new ObsidianWebDavClient({
        baseUrl: this.settings.webdavUrl,
        remoteBase: this.settings.remoteBase,
        user: this.settings.webdavUser,
        pass: this.settings.webdavPass,
        request: this.makeRequest(),
      });
      const vault = new ObsidianVaultWriter(this.app.vault.adapter);
      const store = new PluginStateStore(this.state, async (st) => {
        this.state = st;
        await this.persist();
      });
      const engine = new SyncEngine({
        webdav,
        vault,
        state: store,
        settings: this.settings,
        onProgress: (done, total) => this.status.setSyncing(done, total),
      });

      this.status.setSyncing(0, 0);
      const stats = await engine.run();
      this.status.setSynced(this.state.lastSync ?? Date.now());
      new Notice(`Synced ${stats.downloaded}, failed ${stats.failed}, deleted ${stats.deleted}`);
    } catch (err) {
      this.status.setFailed();
      new Notice(`Sync failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.syncing = false;
    }
  }

  async resetState(): Promise<void> {
    this.state = { fileState: {} };
    await this.persist();
    new Notice("Local sync state reset — next sync re-downloads everything");
  }

  async saveSettings(): Promise<void> {
    await this.persist();
  }

  private async loadStored(): Promise<void> {
    const data = (await this.loadData()) as Partial<StoredData> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(data?.settings ?? {}) };
    this.state = data?.state ?? { fileState: {} };
  }

  private async persist(): Promise<void> {
    const data: StoredData = { settings: this.settings, state: this.state };
    await this.saveData(data);
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck -w plugin`
Expected: no errors. (If the ribbon icon name is rejected, any valid Lucide id works; `"refresh-cw"` is standard.)

- [ ] **Step 4: Build**

Run: `npm run build -w plugin`
Expected: "Built main.js".

- [ ] **Step 5: Commit**

```bash
git add plugin/src/settings.ts plugin/src/main.ts
git commit -m "feat(plugin): scheduler, sync-on-open, status bar, ribbon, reset command"
```

---

### Task 8: Full suite + typecheck + build + docs

- [ ] **Step 1: Run everything**

Run: `npm test && npm run typecheck && npm run build -w plugin`
Expected: all tests pass (plugin gains ~20 new); typechecks clean; main.js builds.

- [ ] **Step 2: Update `CLAUDE.md`** — mark M3 done; note new settings (`syncInterval`, `syncOnOpen`), Scheduler/StatusUI, `Reset local sync state` command.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: mark M3 (scheduler + settings + status) done"
```

---

## Self-review notes

- **Spec coverage §6.3–6.5:** Scheduler `setInterval` + sync-on-open (Tasks 3,7), interval presets (Task 1), full SettingsTab with Test connection (Tasks 4,7), StatusUI status bar + ribbon + Notice with progress (Tasks 2,5,6,7), `Sync now` + `Reset local sync state` commands (Task 7). ETag short-circuit still deferred to M4.
- **iOS honesty:** interval/sync-on-open copy states foreground-only; still `requestUrl`, no Buffer.
- **Testability:** interval/status/scheduler/validate/engine-progress all pure + unit-tested; only `status-ui.ts`, `settings.ts`, `main.ts` are runtime, covered by typecheck + build.
- **Type consistency:** `PluginSettings` extended once (Task 1) and reused; `SyncPhase`, `Timers`, `ConnectionResult` defined once; engine `onProgress` optional so M2 callers still compile.
