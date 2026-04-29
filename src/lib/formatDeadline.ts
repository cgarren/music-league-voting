/**
 * Formats a deadline timestamp for the voting / admin UI.
 *
 * Returns a short, human-readable string in the viewer's own locale and time
 * zone. Server-rendered output uses the server's locale, so the wall-clock
 * value can drift from the voter's locale; that's fine for an informational
 * "target deadline" notice — voting close is manual regardless.
 *
 * If `deadline` is null/undefined the function returns null so callers can
 * easily skip rendering.
 */
export function formatDeadline(deadline: string | null | undefined): string | null {
  if (!deadline) return null;
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/** Format a deadline in a specific IANA timezone. */
export function formatDeadlineInTimeZone(
  deadline: string | null | undefined,
  timeZone: string | null | undefined,
): string | null {
  if (!deadline || !timeZone) return null;
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return d.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone,
      timeZoneName: "short",
    });
  } catch {
    return null;
  }
}

/**
 * True iff the given deadline is in the past relative to "now". Returns false
 * for null/invalid input so the UI gracefully falls back to "no deadline" copy.
 */
export function isDeadlinePast(
  deadline: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!deadline) return false;
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() <= now.getTime();
}
