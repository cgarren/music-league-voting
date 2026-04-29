"use client";

import { useMemo, useState, useTransition } from "react";
import { updateRoundDeadlines } from "@/app/actions/admin";
import { formatDeadline } from "@/lib/formatDeadline";

type Field = "round1_deadline_at" | "round2_deadline_at";

type Props = {
  round1DeadlineAt: string | null;
  round2DeadlineAt: string | null;
  deadlineTimezone: string | null;
};

const COMMON_TIMEZONES = [
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Toronto",
  "America/Sao_Paulo",
  "UTC",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
] as const;

function toInputValue(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toDisplayValue(inputValue: string): string | null {
  if (!inputValue) return null;
  const d = new Date(inputValue);
  if (Number.isNaN(d.getTime())) return null;
  return formatDeadline(d.toISOString());
}

export function DeadlineEditor({
  round1DeadlineAt,
  round2DeadlineAt,
  deadlineTimezone,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";

  const resolvedInitialTimezone =
    deadlineTimezone && deadlineTimezone.trim().length > 0
      ? deadlineTimezone
      : browserTimezone;
  const initialTimezone = COMMON_TIMEZONES.includes(
    resolvedInitialTimezone as (typeof COMMON_TIMEZONES)[number],
  )
    ? resolvedInitialTimezone
    : "UTC";

  const [saved, setSaved] = useState({
    round1_deadline_at: toInputValue(round1DeadlineAt),
    round2_deadline_at: toInputValue(round2DeadlineAt),
    deadline_timezone: initialTimezone,
  });
  const [values, setValues] = useState(saved);

  const isDirty = useMemo(
    () =>
      values.round1_deadline_at !== saved.round1_deadline_at ||
      values.round2_deadline_at !== saved.round2_deadline_at ||
      values.deadline_timezone !== saved.deadline_timezone,
    [saved, values],
  );

  const setField = (field: Field, next: string) => {
    setError(null);
    setValues((prev) => ({ ...prev, [field]: next }));
  };

  const clearField = (field: Field) => {
    setError(null);
    setValues((prev) => ({ ...prev, [field]: "" }));
  };

  const handleSave = () => {
    setError(null);
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.set("round1_deadline_at", values.round1_deadline_at);
        formData.set("round2_deadline_at", values.round2_deadline_at);
        formData.set("deadline_timezone", values.deadline_timezone);
        await updateRoundDeadlines(formData);
        setSaved(values);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  const round1SavedDisplay = toDisplayValue(saved.round1_deadline_at);
  const round2SavedDisplay = toDisplayValue(saved.round2_deadline_at);

  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <DeadlineField
        label="Round 1 deadline"
        value={values.round1_deadline_at}
        onChange={(next) => setField("round1_deadline_at", next)}
        onClear={() => clearField("round1_deadline_at")}
        clearDisabled={!values.round1_deadline_at}
        savedDisplay={round1SavedDisplay}
      />
      <DeadlineField
        label="Round 2 deadline"
        value={values.round2_deadline_at}
        onChange={(next) => setField("round2_deadline_at", next)}
        onClear={() => clearField("round2_deadline_at")}
        clearDisabled={!values.round2_deadline_at}
        savedDisplay={round2SavedDisplay}
      />
      <div className="sm:col-span-2 flex flex-col gap-1 text-sm">
        <label htmlFor="deadline-timezone" className="font-medium">
          Original deadline timezone
        </label>
        <div className="flex flex-wrap items-stretch gap-2">
          <select
            id="deadline-timezone"
            value={values.deadline_timezone}
            onChange={(e) =>
              setValues((prev) => ({
                ...prev,
                deadline_timezone: e.target.value,
              }))
            }
            className="min-w-[18rem] flex-1 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] px-3 py-2 text-sm focus:border-[color:var(--color-accent)] focus:outline-none"
          >
            {COMMON_TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() =>
              setValues((prev) => ({
                ...prev,
                deadline_timezone: COMMON_TIMEZONES.includes(
                  browserTimezone as (typeof COMMON_TIMEZONES)[number],
                )
                  ? browserTimezone
                  : "UTC",
              }))
            }
            className="rounded-lg border border-[color:var(--color-border)] px-3 text-xs font-medium text-[color:var(--color-muted)] hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
          >
            Use browser timezone
          </button>
        </div>
        <span className="text-[11px] text-[color:var(--color-muted)]">
          Voters always see their local time first; if different, we show a
          small note in this original timezone too.
        </span>
      </div>

      <div className="sm:col-span-2 flex items-center justify-end gap-3">
        {error ? (
          <p className="text-xs text-[color:var(--color-danger)]">{error}</p>
        ) : null}
        <button
          type="button"
          onClick={handleSave}
          disabled={pending || !isDirty}
          className="rounded-full bg-[color:var(--color-accent)] px-5 py-2 text-sm font-medium text-white hover:bg-[color:var(--color-accent-strong)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? "Saving..." : "Save deadlines"}
        </button>
      </div>
    </div>
  );
}

function DeadlineField({
  label,
  value,
  onChange,
  onClear,
  clearDisabled,
  savedDisplay,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  onClear: () => void;
  clearDisabled: boolean;
  savedDisplay: string | null;
}) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <div className="flex items-stretch gap-2">
        <input
          type="datetime-local"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 min-w-0 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] px-3 py-2 text-sm focus:border-[color:var(--color-accent)] focus:outline-none"
        />
        <button
          type="button"
          onClick={onClear}
          disabled={clearDisabled}
          className="h-full rounded-lg border border-[color:var(--color-border)] px-3 text-xs font-medium text-[color:var(--color-muted)] hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[color:var(--color-border)] disabled:hover:text-[color:var(--color-muted)]"
        >
          Clear
        </button>
      </div>
      <span className="text-[11px] text-[color:var(--color-muted)]">
        {savedDisplay ? `Currently set to ${savedDisplay}.` : "Not set."}
      </span>
    </div>
  );
}
