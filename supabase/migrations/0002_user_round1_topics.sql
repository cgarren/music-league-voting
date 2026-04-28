-- Round-1 user-submitted topics
--
-- Lets a voter add their own topic at the bottom of the Round 1 ballot. The
-- new topic counts as one of their three picks and persists into Round 2 as
-- a survivor (since the submitter has voted for it).
--
-- Design constraints carried over from 0001_init.sql:
--   * No INSERT/UPDATE/DELETE policies on `public.topics` for `authenticated`.
--     The `submit_round1_ballot` RPC below is SECURITY DEFINER and is the
--     only path by which a non-admin can mutate `topics`.
--   * `submitter` (text) and the new `submitted_by` (uuid) columns must not
--     be readable by voters during Round 1. The existing column-scoped
--     grant on `topics` excludes `submitter`; new columns are not
--     auto-granted, so `submitted_by` is excluded too.
--   * The user's own submission can still be displayed back to them via the
--     phase-agnostic `get_my_round1_topic` SECURITY DEFINER RPC.

-- =============================================================================
-- Schema
-- =============================================================================

-- on delete set null (not cascade): if a Supabase auth user is deleted, we
-- want their suggested topic to remain in place if other voters have already
-- picked it. We just lose the link back to the (now-gone) submitter.
alter table public.topics
  add column if not exists submitted_by uuid references auth.users(id) on delete set null;

-- At most one live (non-removed) user-submitted topic per (session, user).
-- Partial so admin-imported rows (submitted_by IS NULL) are unconstrained,
-- and so a removed submission frees the slot for a new one.
create unique index if not exists topics_one_user_submission_idx
  on public.topics (session_id, submitted_by)
  where submitted_by is not null and removed = false;

-- Cover the new foreign key so ON DELETE SET NULL from auth.users doesn't
-- fall back to a sequential scan of public.topics. The partial unique index
-- above doesn't qualify (leading column is session_id and it's filtered on
-- removed = false).
create index if not exists topics_submitted_by_idx
  on public.topics (submitted_by)
  where submitted_by is not null;

-- =============================================================================
-- get_my_round1_topic — read-back for the ballot's textarea
-- =============================================================================
-- SECURITY DEFINER because `submitted_by` is intentionally not granted to the
-- `authenticated` role (mirrors the `submitter` column-hide pattern). Returns
-- only the caller's own row.
create or replace function public.get_my_round1_topic(p_session_id uuid)
returns table (id uuid, topic_text text)
language sql
security definer
stable
set search_path = public
as $$
  select t.id, t.topic_text
  from public.topics t
  where t.session_id = p_session_id
    and t.submitted_by = (select auth.uid())
    and t.removed = false
  limit 1;
$$;

revoke all on function public.get_my_round1_topic(uuid) from public;
grant execute on function public.get_my_round1_topic(uuid) to authenticated;

-- =============================================================================
-- submit_round1_ballot — atomic ballot submission with optional user topic
-- =============================================================================
-- Replaces the previous "delete then insert 3 round1_votes" code path that
-- lived in src/app/actions/vote.ts. Now a single PG function so:
--   1. The optional user-suggested-topic upsert and the vote insert happen in
--      one transaction (no half-saved ballots if either side fails).
--   2. Dedup against existing topics is checked under the same snapshot.
--   3. The whole flow can be SECURITY DEFINER (we need elevated rights to
--      mutate `topics` and to read `auth.users` for the submitter name).
--
-- SECURITY DEFINER safety:
--   * Pinned `search_path = public`.
--   * `auth.uid()` is captured once into a local; null-checked.
--   * Only validation results (raised exceptions) and writes to the caller's
--     own ballot are exposed — no ability to enumerate other users' rows.
create or replace function public.submit_round1_ballot(
  p_session_id      uuid,
  p_topic_ids       uuid[],
  p_user_topic_text text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id            uuid := (select auth.uid());
  v_phase              public.session_phase;
  v_normalized         text;
  v_existing_topic_id  uuid;
  v_user_topic_id      uuid;
  v_other_voters       int;
  v_dup_other          uuid;
  v_user_email         text;
  v_user_name          text;
  v_combined_ids       uuid[];
  v_distinct_ids       uuid[];
  v_invalid_count      int;
begin
  if v_user_id is null then
    raise exception 'Please sign in.' using errcode = '28000';
  end if;

  -- Phase gate (the round1_votes BEFORE INSERT trigger checks this too;
  -- we check up-front so we can fail fast with a friendlier message).
  select s.phase into v_phase from public.sessions s where s.id = p_session_id;
  if v_phase is null then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;
  if v_phase <> 'round1' then
    raise exception 'Round 1 voting is not open (phase=%).', v_phase
      using errcode = 'check_violation';
  end if;

  -- ---- Resolve / handle the user-suggested topic ----------------------
  if p_user_topic_text is not null then
    p_user_topic_text := btrim(p_user_topic_text);
    if length(p_user_topic_text) = 0 then
      p_user_topic_text := null;
    elsif length(p_user_topic_text) > 500 then
      raise exception 'Suggested topic is too long (max 500 characters).'
        using errcode = 'check_violation';
    end if;
  end if;

  -- Existing live submission for this user+session, if any.
  select t.id into v_existing_topic_id
  from public.topics t
  where t.session_id = p_session_id
    and t.submitted_by = v_user_id
    and t.removed = false
  limit 1;

  if p_user_topic_text is not null then
    -- Same normalization as src/app/actions/admin.ts → normalizeTopic / importTopics.
    -- Keep these in lockstep — divergence would let the same text show up
    -- twice in the topic list.
    v_normalized := btrim(
      regexp_replace(
        regexp_replace(lower(p_user_topic_text), '\s+', ' ', 'g'),
        '[^[:alnum:] ]+', '', 'g'
      )
    );
    if length(v_normalized) = 0 then
      raise exception 'Suggested topic is empty after normalization.'
        using errcode = 'check_violation';
    end if;

    -- Reject duplicates against any other live topic in the session. Editing
    -- the text of the user's OWN existing submission is allowed.
    select t.id into v_dup_other
    from public.topics t
    where t.session_id = p_session_id
      and t.removed = false
      and t.normalized_text = v_normalized
      and (v_existing_topic_id is null or t.id <> v_existing_topic_id)
    limit 1;
    if v_dup_other is not null then
      raise exception 'That topic already exists in this round. Pick it from the list instead.'
        using errcode = 'unique_violation';
    end if;

    -- Snapshot a display name into `submitter` (visible in admin / Round 2 /
    -- Results, same as sheet-imported rows). Falls back to email local-part.
    select au.email,
           coalesce(
             nullif(btrim(au.raw_user_meta_data->>'full_name'), ''),
             nullif(btrim(au.raw_user_meta_data->>'name'), ''),
             split_part(au.email, '@', 1)
           )
      into v_user_email, v_user_name
    from auth.users au
    where au.id = v_user_id;

    if v_existing_topic_id is null then
      insert into public.topics (session_id, topic_text, normalized_text, submitter, submitted_by)
      values (p_session_id, p_user_topic_text, v_normalized, coalesce(v_user_name, ''), v_user_id)
      returning id into v_user_topic_id;
    else
      update public.topics
        set topic_text      = p_user_topic_text,
            normalized_text = v_normalized
        where id = v_existing_topic_id;
      v_user_topic_id := v_existing_topic_id;
    end if;
  else
    -- Textarea was empty. If the user previously had a submission and no one
    -- else has voted for it yet, drop it cleanly. If others have voted, we
    -- leave the topic in place (their picks must continue to resolve) and
    -- just remove the caller's own vote when we wipe + reinsert below.
    if v_existing_topic_id is not null then
      select count(*) into v_other_voters
      from public.round1_votes r
      where r.topic_id = v_existing_topic_id
        and r.user_id  <> v_user_id;
      if v_other_voters = 0 then
        delete from public.topics where id = v_existing_topic_id;
      end if;
    end if;
    v_user_topic_id := null;
  end if;

  -- ---- Compose & validate the final ballot ---------------------------
  v_combined_ids := coalesce(p_topic_ids, array[]::uuid[]);
  if v_user_topic_id is not null then
    v_combined_ids := array_append(v_combined_ids, v_user_topic_id);
  end if;

  select array_agg(distinct e) into v_distinct_ids from unnest(v_combined_ids) e;
  if v_distinct_ids is null or array_length(v_distinct_ids, 1) <> 3 then
    raise exception 'Round 1 ballot must contain exactly 3 distinct topics (got %).',
      coalesce(array_length(v_distinct_ids, 1), 0)
      using errcode = 'check_violation';
  end if;

  -- All ids must reference live topics in this session.
  select count(*) into v_invalid_count
  from unnest(v_distinct_ids) tid
  where not exists (
    select 1 from public.topics t
    where t.id = tid and t.session_id = p_session_id and t.removed = false
  );
  if v_invalid_count > 0 then
    raise exception 'One or more selected topics are invalid for this session.'
      using errcode = 'check_violation';
  end if;

  -- ---- Replace the user's R1 votes ----------------------------------
  delete from public.round1_votes
   where user_id = v_user_id and session_id = p_session_id;

  insert into public.round1_votes (user_id, topic_id, session_id)
  select v_user_id, t, p_session_id from unnest(v_distinct_ids) t;
end;
$$;

revoke all on function public.submit_round1_ballot(uuid, uuid[], text) from public;
grant execute on function public.submit_round1_ballot(uuid, uuid[], text) to authenticated;
