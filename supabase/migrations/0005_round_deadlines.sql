-- Round deadlines (informational only)
--
-- Adds optional per-round target deadlines to public.sessions. These are
-- displayed prominently to voters and admins but do NOT close voting:
--   * No triggers reference them — round1/round2 vote inserts/updates are
--     gated solely by sessions.phase, exactly as before.
--   * No RLS policy references them.
--   * No server action enforces them; the only way to close a round is the
--     admin's manual phase transition.
--
-- The two columns are nullable so an admin can leave them unset (or clear a
-- previously set deadline). No default — explicit null reads as "no
-- deadline set yet" in the UI.
--
-- Grants: public.sessions has a blanket `grant select ... to authenticated`
-- (see 0001_init.sql), so newly added columns are automatically readable by
-- signed-in users. service_role already has full write access via the same
-- blanket grant. Nothing else to wire up here.

alter table public.sessions
  add column if not exists round1_deadline_at timestamptz,
  add column if not exists round2_deadline_at timestamptz;
