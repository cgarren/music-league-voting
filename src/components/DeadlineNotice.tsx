"use client";

import {
  formatDeadline,
  formatDeadlineInTimeZone,
  isDeadlinePast,
} from "@/lib/formatDeadline";

/**
 * Prominent target-deadline notice for the voting pages.
 *
 * Renders nothing when no deadline has been set so callers can use it
 * unconditionally inside their headers. The voting pages remain functional
 * past the deadline; this component only describes the *target* — the round
 * is closed manually by the admin via a phase transition.
 */
export function DeadlineNotice({
  deadline,
  roundLabel,
  originalTimezone,
}: {
  deadline: string | null | undefined;
  roundLabel: string;
  originalTimezone?: string | null;
}) {
  const formatted = formatDeadline(deadline);
  const past = isDeadlinePast(deadline);
  const viewerTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;

  const showOriginalTzNote =
    !!originalTimezone &&
    !!viewerTimezone &&
    originalTimezone !== viewerTimezone;
  const originalFormatted = showOriginalTzNote
    ? formatDeadlineInTimeZone(deadline, originalTimezone)
    : null;
  if (!formatted) return null;

  return (
    <div
      role="note"
      className={
        past
          ? "mt-4 flex flex-col gap-1 rounded-xl border border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/10 px-4 py-3 text-sm sm:flex-row sm:items-center sm:gap-3"
          : "mt-4 flex flex-col gap-1 rounded-xl border border-[color:var(--color-accent)]/40 bg-[color:var(--color-accent)]/10 px-4 py-3 text-sm sm:flex-row sm:items-center sm:gap-3"
      }
    >
      <span
        className={
          past
            ? "text-[11px] font-semibold uppercase tracking-wide text-[color:var(--color-danger)]"
            : "text-[11px] font-semibold uppercase tracking-wide text-[color:var(--color-accent)]"
        }
      >
        {past ? `${roundLabel} deadline passed` : `${roundLabel} deadline`}
      </span>
      <span className="font-medium text-pretty">{formatted}</span>
      {past ? (
        <span className="text-[color:var(--color-muted)] sm:ml-auto sm:text-xs">
          Voting still open until the admin closes the round.
        </span>
      ) : null}
      {originalFormatted && originalTimezone ? (
        <span className="text-[11px] text-[color:var(--color-muted)] sm:basis-full">
          Original timezone ({originalTimezone}): {originalFormatted}
        </span>
      ) : null}
    </div>
  );
}
