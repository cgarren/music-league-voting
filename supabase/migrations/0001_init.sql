-- Music League Topic Voting — initial schema
--
-- Design notes:
--   * One "active" session at a time. Archiving a session frees the slot so
--     admin can start a new one. Enforced by a partial unique index.
--   * The session tracks phase state (setup / round1 / round2 / results /
--     archived). Client & server both gate behavior on this.
--   * Votes live in their own tables with (user_id, topic_id) PKs so each
--     user can only have one row per topic per round. RLS scopes inserts and
--     reads to auth.uid(). Triggers enforce ballot caps (3 in R1, weight sum
--     ≤ 10 in R2).
--   * Results views expose aggregate counts without leaking individual
--     ballots. Created with security_invoker so RLS on the base tables still
--     applies. Access is gated via dedicated SECURITY DEFINER functions that
--     only return rows when phase = 'results'.
--   * `sessions` and `topics` are never written by end-users; admin server
--     actions use the Supabase secret key (sb_secret_...), which bypasses
--     RLS entirely. RLS on those tables therefore only needs SELECT
--     policies for authenticated clients.

-- =============================================================================
-- Enums
-- =============================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'session_phase') then
    create type public.session_phase as enum (
      'setup',     -- admin has created session, may import/edit topics
      'round1',    -- users pick up to 3 topics
      'round2',    -- users spend 10 points across round-1 survivors
      'results',   -- top 10 revealed
      'archived'   -- historical session
    );
  end if;
end$$;

-- =============================================================================
-- Tables
-- =============================================================================
create table if not exists public.sessions (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  sheet_url     text,
  phase         public.session_phase not null default 'setup',
  created_at    timestamptz not null default now(),
  archived_at   timestamptz
);

-- At most one active (non-archived) session at a time.
create unique index if not exists sessions_one_active_idx
  on public.sessions ((true)) where archived_at is null;

create table if not exists public.topics (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references public.sessions(id) on delete cascade,
  topic_text      text not null,
  submitter       text not null default '',
  normalized_text text not null,
  removed         boolean not null default false,
  created_at      timestamptz not null default now()
);

create index if not exists topics_session_idx on public.topics (session_id);
create index if not exists topics_normalized_idx
  on public.topics (session_id, normalized_text);

create table if not exists public.round1_votes (
  user_id    uuid not null references auth.users(id) on delete cascade,
  topic_id   uuid not null references public.topics(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, topic_id)
);

create index if not exists round1_votes_topic_idx
  on public.round1_votes (topic_id);
create index if not exists round1_votes_session_user_idx
  on public.round1_votes (session_id, user_id);

create table if not exists public.round2_votes (
  user_id    uuid not null references auth.users(id) on delete cascade,
  topic_id   uuid not null references public.topics(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  weight     smallint not null check (weight between 1 and 10),
  created_at timestamptz not null default now(),
  primary key (user_id, topic_id)
);

create index if not exists round2_votes_topic_idx
  on public.round2_votes (topic_id);
create index if not exists round2_votes_session_user_idx
  on public.round2_votes (session_id, user_id);

-- =============================================================================
-- Ballot-cap triggers
-- =============================================================================
create or replace function public.enforce_round1_cap()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  active_phase public.session_phase;
  ballot_count int;
begin
  -- Phase gate: only allow R1 writes when session is in round1.
  select phase into active_phase from public.sessions where id = NEW.session_id;
  if active_phase is null then
    raise exception 'Unknown session %', NEW.session_id;
  end if;
  if active_phase <> 'round1' then
    raise exception 'Round 1 voting is not open (phase=%).', active_phase
      using errcode = 'check_violation';
  end if;

  if TG_OP = 'INSERT' then
    select count(*) into ballot_count
      from public.round1_votes
      where user_id = NEW.user_id and session_id = NEW.session_id;
    if ballot_count >= 3 then
      raise exception 'Round 1 ballot limit reached (max 3 topics).'
        using errcode = 'check_violation';
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists round1_cap_check on public.round1_votes;
create trigger round1_cap_check
before insert or update on public.round1_votes
for each row execute function public.enforce_round1_cap();

-- SECURITY DEFINER is required here (not just `invoker`) because the
-- survivor-existence check reads public.round1_votes, which is locked down by
-- RLS to the caller's own rows (see `r1_select_own`). Under SECURITY INVOKER
-- the check would fail for any topic the caller didn't personally pick in R1,
-- even when that topic is a legitimate survivor thanks to somebody else's
-- vote. We keep a pinned search_path and only expose validation results
-- (booleans, not R1 ballot data) so this doesn't leak anything.
create or replace function public.enforce_round2_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  active_phase public.session_phase;
  total_weight int;
begin
  select phase into active_phase from public.sessions where id = NEW.session_id;
  if active_phase is null then
    raise exception 'Unknown session %', NEW.session_id;
  end if;
  if active_phase <> 'round2' then
    raise exception 'Round 2 voting is not open (phase=%).', active_phase
      using errcode = 'check_violation';
  end if;

  select coalesce(sum(weight), 0) into total_weight
    from public.round2_votes
    where user_id = NEW.user_id
      and session_id = NEW.session_id
      and topic_id <> NEW.topic_id;

  if total_weight + NEW.weight > 10 then
    raise exception 'Round 2 total weight would exceed 10 (have %, adding %).',
      total_weight, NEW.weight
      using errcode = 'check_violation';
  end if;

  -- R2 ballots only count for topics that survived R1. This existence check
  -- intentionally runs with definer privileges so it sees ballots cast by
  -- every user, not just the caller's own.
  if not exists (
    select 1
    from public.round1_votes r
    where r.topic_id = NEW.topic_id
      and r.session_id = NEW.session_id
  ) then
    raise exception 'Topic is not a round-1 survivor and cannot receive round-2 votes.'
      using errcode = 'check_violation';
  end if;

  return NEW;
end;
$$;

drop trigger if exists round2_cap_check on public.round2_votes;
create trigger round2_cap_check
before insert or update on public.round2_votes
for each row execute function public.enforce_round2_cap();

-- =============================================================================
-- Results views & access functions
-- =============================================================================
-- Aggregate tallies. security_invoker ensures base-table RLS is applied.
create or replace view public.v_round1_results
with (security_invoker = true) as
select
  t.id           as topic_id,
  t.session_id,
  t.topic_text,
  t.submitter,
  t.normalized_text,
  coalesce(c.vote_count, 0)::int as vote_count
from public.topics t
left join (
  select topic_id, count(*)::int as vote_count
  from public.round1_votes
  group by topic_id
) c on c.topic_id = t.id
where t.removed = false;

create or replace view public.v_round2_results
with (security_invoker = true) as
select
  t.id           as topic_id,
  t.session_id,
  t.topic_text,
  t.submitter,
  coalesce(sum(r.weight), 0)::int as total_points,
  count(distinct r.user_id)::int  as voter_count
from public.topics t
left join public.round2_votes r on r.topic_id = t.id
where t.removed = false
group by t.id, t.session_id, t.topic_text, t.submitter;

-- SECURITY DEFINER functions so the admin/service role can publish results to
-- all authenticated users without exposing raw ballot tables. Each function
-- checks that the session has been moved to 'results' before returning rows.
create or replace function public.get_results(p_session_id uuid)
returns table (
  rank          int,
  topic_id      uuid,
  topic_text    text,
  submitter     text,
  total_points  int,
  voter_count   int
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.sessions s
    where s.id = p_session_id and s.phase = 'results'
  ) then
    return;
  end if;

  return query
  select
    row_number() over (order by coalesce(sum(r.weight), 0) desc, t.topic_text)::int as rank,
    t.id,
    t.topic_text,
    t.submitter,
    coalesce(sum(r.weight), 0)::int as total_points,
    count(distinct r.user_id)::int  as voter_count
  from public.topics t
  left join public.round2_votes r on r.topic_id = t.id
  where t.session_id = p_session_id
    and t.removed = false
  group by t.id, t.topic_text, t.submitter
  order by total_points desc, t.topic_text
  limit 10;
end;
$$;

revoke all on function public.get_results(uuid) from public;
grant execute on function public.get_results(uuid) to authenticated;

-- Round-2 ballot: list of R1 survivors for a session. Gated to phases where
-- the ballot is actually visible (round2) or revealed (results).
create or replace function public.get_round2_ballot(p_session_id uuid)
returns table (
  topic_id   uuid,
  topic_text text,
  submitter  text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.sessions s
    where s.id = p_session_id and s.phase in ('round2', 'results')
  ) then
    return;
  end if;
  return query
  select distinct t.id, t.topic_text, t.submitter
  from public.topics t
  join public.round1_votes r on r.topic_id = t.id
  where t.session_id = p_session_id
    and t.removed = false
  order by t.topic_text;
end;
$$;

revoke all on function public.get_round2_ballot(uuid) from public;
grant execute on function public.get_round2_ballot(uuid) to authenticated;

-- Public snapshot of the active (non-archived) session. Safe to call
-- unauthenticated so the landing page can display the current phase and prompt
-- sign-in. Intentionally omits `sheet_url` and other admin-only columns.
create or replace function public.get_public_session()
returns table (
  id         uuid,
  name       text,
  phase      public.session_phase,
  created_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select s.id, s.name, s.phase, s.created_at
  from public.sessions s
  where s.archived_at is null
  limit 1;
$$;

revoke all on function public.get_public_session() from public;
grant execute on function public.get_public_session() to anon, authenticated;

-- =============================================================================
-- Table privileges
-- =============================================================================
-- Modern Supabase projects do NOT grant default privileges to the
-- `authenticated` or `service_role` roles on newly created public objects.
-- RLS alone does nothing without a matching table-level GRANT, and the
-- service role (used by the server-side admin client with the secret key) also
-- needs explicit privileges even though it bypasses RLS.
grant usage on schema public to authenticated, service_role;

-- Read-only surface for authenticated users.
grant select on public.sessions                    to authenticated;
-- NOTE: column-scoped grant. `submitter` is intentionally NOT granted so
-- Round 1 stays blind — authenticated users can read topic text but never
-- the submitter through a direct table query. Submitter is only reachable
-- via the phase-gated SECURITY DEFINER RPCs `get_round2_ballot()` and
-- `get_results()`, which are callable only in Round 2 / Results.
grant select (id, session_id, topic_text, normalized_text, removed, created_at)
  on public.topics to authenticated;
grant select, insert, delete            on public.round1_votes to authenticated;
grant select, insert, update, delete    on public.round2_votes to authenticated;
-- Aggregation views expose the submitter; keep them internal to the admin
-- (service_role) surface.
revoke all on public.v_round1_results from authenticated;
revoke all on public.v_round2_results from authenticated;
grant select on public.v_session_stats             to authenticated;

-- Full access for the admin/service role (RLS is bypassed automatically)
grant select, insert, update, delete on public.sessions      to service_role;
grant select, insert, update, delete on public.topics        to service_role;
grant select, insert, update, delete on public.round1_votes  to service_role;
grant select, insert, update, delete on public.round2_votes  to service_role;
grant select on public.v_round1_results to service_role;
grant select on public.v_round2_results to service_role;
grant select on public.v_session_stats  to service_role;
grant usage, select on all sequences in schema public to service_role;

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.sessions      enable row level security;
alter table public.topics        enable row level security;
alter table public.round1_votes  enable row level security;
alter table public.round2_votes  enable row level security;

-- sessions: readable by any signed-in user; writes only via service role.
drop policy if exists sessions_select_authenticated on public.sessions;
create policy sessions_select_authenticated on public.sessions
  for select to authenticated using (true);

-- topics: readable by any signed-in user; writes only via service role.
drop policy if exists topics_select_authenticated on public.topics;
create policy topics_select_authenticated on public.topics
  for select to authenticated using (removed = false);

-- round1_votes: users manage only their own, and only while session is in
-- round1. Reads are scoped to own rows too so ballots remain private.
-- Note: `(select auth.uid())` not `auth.uid()` — the subselect lets Postgres
-- cache the value per statement rather than re-evaluating per row. See:
--   https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select
drop policy if exists r1_select_own on public.round1_votes;
create policy r1_select_own on public.round1_votes
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists r1_insert_own on public.round1_votes;
create policy r1_insert_own on public.round1_votes
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.sessions s
      where s.id = session_id and s.phase = 'round1'
    )
  );

drop policy if exists r1_delete_own on public.round1_votes;
create policy r1_delete_own on public.round1_votes
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.sessions s
      where s.id = session_id and s.phase = 'round1'
    )
  );

-- round2_votes: same pattern, phase = round2.
drop policy if exists r2_select_own on public.round2_votes;
create policy r2_select_own on public.round2_votes
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists r2_insert_own on public.round2_votes;
create policy r2_insert_own on public.round2_votes
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.sessions s
      where s.id = session_id and s.phase = 'round2'
    )
  );

drop policy if exists r2_update_own on public.round2_votes;
create policy r2_update_own on public.round2_votes
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.sessions s
      where s.id = session_id and s.phase = 'round2'
    )
  );

drop policy if exists r2_delete_own on public.round2_votes;
create policy r2_delete_own on public.round2_votes
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.sessions s
      where s.id = session_id and s.phase = 'round2'
    )
  );

-- =============================================================================
-- Helper: admin counts. Only the admin dashboard queries this (via the
-- secret key, which bypasses RLS); views inherit base-table RLS otherwise.
-- =============================================================================
create or replace view public.v_session_stats
with (security_invoker = true) as
select
  s.id as session_id,
  (select count(*) from public.topics t where t.session_id = s.id and t.removed = false) as topic_count,
  (select count(distinct user_id) from public.round1_votes r where r.session_id = s.id) as r1_voter_count,
  (select count(*) from public.round1_votes r where r.session_id = s.id) as r1_ballot_count,
  (select count(distinct user_id) from public.round2_votes r where r.session_id = s.id) as r2_voter_count,
  (select count(*) from public.round2_votes r where r.session_id = s.id) as r2_ballot_count
from public.sessions s;
