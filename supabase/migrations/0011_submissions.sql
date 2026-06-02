-- Migration 0011: Integrated Submissions Support
--
-- Adds a new session phase 'submitting' and a 'submission_cap' configuration,
-- creates a 'submissions' table for user suggestions, and adds a database RPC
-- to promote submissions to topics.

-- 1. Add 'submitting' to the session_phase enum
alter type public.session_phase add value if not exists 'submitting' after 'setup';

-- 2. Add submission_cap to public.sessions
alter table public.sessions
  add column if not exists submission_cap int default null;

-- 3. Create the public.submissions table
create table if not exists public.submissions (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references public.sessions(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  topic_text      text not null,
  normalized_text text not null,
  created_at      timestamptz not null default now(),
  constraint submissions_user_unique_topic unique (session_id, user_id, normalized_text)
);

create index if not exists submissions_session_idx on public.submissions (session_id);
create index if not exists submissions_user_idx on public.submissions (session_id, user_id);

-- 4. Enable Row Level Security (RLS)
alter table public.submissions enable row level security;

-- 5. Create RLS Policies
-- Authenticated users can insert their own submissions only if the active session is in the 'submitting' phase.
drop policy if exists submissions_insert_own on public.submissions;
create policy submissions_insert_own on public.submissions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.sessions s
      where s.id = session_id and s.phase = 'submitting'
    )
  );

-- Authenticated users can read all submissions (so the public suggestion list can display them)
drop policy if exists submissions_select_all on public.submissions;
create policy submissions_select_all on public.submissions
  for select to authenticated
  using (true);

-- 6. RPC to promote submissions to topics
-- SECURITY DEFINER allows it to join auth.users to fetch display names safely.
create or replace function public.promote_submissions(p_session_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted int := 0;
begin
  -- Insert unique submissions into public.topics
  -- Group by normalized_text to avoid duplicates, picking one submission text & resolving submitter
  insert into public.topics (session_id, topic_text, normalized_text, submitter, submitted_by)
  select distinct on (s.normalized_text)
    p_session_id,
    s.topic_text,
    s.normalized_text,
    coalesce(
      nullif(btrim(au.raw_user_meta_data->>'full_name'), ''),
      nullif(btrim(au.raw_user_meta_data->>'name'), ''),
      split_part(au.email, '@', 1),
      ''
    ) as submitter_name,
    null::uuid
  from public.submissions s
  left join auth.users au on au.id = s.user_id
  where s.session_id = p_session_id
  -- Deduplicate against already existing non-removed topics in topics table
  and not exists (
    select 1 from public.topics t
    where t.session_id = p_session_id
      and t.normalized_text = s.normalized_text
      and t.removed = false
  );

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

-- 7. Table & RPC Grants
grant usage on schema public to authenticated, service_role;
grant select, insert on public.submissions to authenticated;
grant select, insert, update, delete on public.submissions to service_role;

revoke all on function public.promote_submissions(uuid) from public;
grant execute on function public.promote_submissions(uuid) to service_role;
