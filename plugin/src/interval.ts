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
