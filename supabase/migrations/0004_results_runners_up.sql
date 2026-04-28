-- Results: skip 0-vote topics and surface the next 10 as "runners up"
--
-- The results page now shows two lists: a top-10 podium and a "Runners up"
-- section for ranks 11-20. Topics with zero votes were previously padding
-- the bottom of the top 10; they are now excluded from both lists.
--
-- Changes vs. the original definition in 0001_init.sql:
--   * `having coalesce(sum(r.weight), 0) > 0` filters out zero-vote topics.
--   * `limit 20` (was 10) so we can render ranks 11-20 underneath.
--
-- Function signature is unchanged, so a plain CREATE OR REPLACE is fine and
-- existing grants (revoke from public, execute to authenticated) carry over.

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
  having coalesce(sum(r.weight), 0) > 0
  order by total_points desc, t.topic_text
  limit 20;
end;
$$;
