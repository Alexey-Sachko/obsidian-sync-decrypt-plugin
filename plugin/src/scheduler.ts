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
