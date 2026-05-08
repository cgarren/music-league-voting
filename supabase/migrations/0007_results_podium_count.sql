-- Per-session: how many leading topics appear on the public results page.
-- Runners up are always the next 10 ranked topics (see get_results).

alter table public.sessions
  add column if not exists results_podium_count int not null default 12
    constraint sessions_results_podium_count_range
      check (results_podium_count between 1 and 50);

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
declare
  podium int;
  runners int := 10;
begin
  select s.results_podium_count
  into podium
  from public.sessions s
  where s.id = p_session_id
    and s.phase = 'results';

  if podium is null then
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
  limit podium + runners;
end;
$$;
