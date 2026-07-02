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
