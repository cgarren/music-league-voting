-- Optional timezone metadata for round deadline display.
--
-- Deadlines are stored as timestamptz instants; this column records the
-- admin-selected "original timezone" label used when presenting comparison
-- copy to voters whose browser timezone differs.
alter table public.sessions
  add column if not exists deadline_timezone text;
