import type { CSSProperties } from "react";

/**
 * 0 = lowest vote total in the published list, 1 = highest. When every topic
 * ties, returns ~0.5 so no card looks "shut off".
 */
export function voteStrength(
  totalPoints: number,
  minPoints: number,
  maxPoints: number,
): number {
  if (maxPoints <= 0) return 0.5;
  if (minPoints === maxPoints) return 0.55;
  return (totalPoints - minPoints) / (maxPoints - minPoints);
}

/**
 * Bar width as % of the leader. Clamped so small totals still read as a
 * visible sliver (without implying they’re <8% of the top when the gap is huge).
 */
export function voteBarWidthPercent(
  totalPoints: number,
  maxPoints: number,
): number {
  if (maxPoints <= 0) return 100;
  return Math.max(8, Math.min(100, (totalPoints / maxPoints) * 100));
}

/** Slight background/border shift + optional soft glow for high-vote rows. */
export function resultCardStyle(strength: number): CSSProperties {
  const s = Math.min(1, Math.max(0, strength));
  const mixSurface = 5 + 16 * s;
  const mixBorder = 26 + 50 * s;
  const style: CSSProperties = {
    background: `color-mix(in srgb, var(--color-accent) ${mixSurface}%, var(--color-surface))`,
    borderColor: `color-mix(in srgb, var(--color-accent) ${mixBorder}%, var(--color-border))`,
  };
  if (s > 0.72) {
    style.boxShadow =
      "0 0 24px -8px color-mix(in srgb, var(--color-accent) 32%, transparent)";
  }
  return style;
}

/**
 * Bar fill: stronger for leaders, but everyone keeps at least ~45% opacity so
 * the track never looks “empty.”
 */
export function voteBarStyle(strength: number): CSSProperties {
  const s = Math.min(1, Math.max(0, strength));
  const opacity = 0.45 + 0.55 * s;
  return { opacity };
}

const RANK_TIER = {
  high: "bg-[color:var(--color-accent)] text-white shadow-md shadow-[color:var(--color-accent)]/20 ring-2 ring-inset ring-white/20",
  mid: "bg-[color:var(--color-accent)]/25 text-[color:var(--color-accent)] ring-1 ring-inset ring-[color:var(--color-accent)]/35",
  low: "bg-[color:var(--color-surface-elevated)] text-[color:var(--color-foreground)] ring-1 ring-inset ring-[color:var(--color-accent)]/25",
} as const;

export function resultRankClass(strength: number): string {
  if (strength >= 0.66) return RANK_TIER.high;
  if (strength >= 0.32) return RANK_TIER.mid;
  return RANK_TIER.low;
}
