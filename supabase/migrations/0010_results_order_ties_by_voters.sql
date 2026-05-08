-- Within the same competition rank (same vote total), order by distinct voter
-- count descending, then topic title for a stable tie-break.

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
  with tallies as (
    select
      t.id as tid,
      t.topic_text as ttext,
      t.submitter as subm,
      coalesce(sum(r.weight), 0)::int as pts,
      count(distinct r.user_id)::int as voters
    from public.topics t
    left join public.round2_votes r on r.topic_id = t.id
    where t.session_id = p_session_id
      and t.removed = false
    group by t.id, t.topic_text, t.submitter
    having coalesce(sum(r.weight), 0) > 0
  ),
  ranked as (
    select
      rank() over (order by pts desc)::int as rnk,
      tid,
      ttext,
      subm,
      pts,
      voters
    from tallies
  )
  select * from (
    select
      ranked.rnk,
      ranked.tid,
      ranked.ttext,
      ranked.subm,
      ranked.pts,
      ranked.voters
    from ranked
    where ranked.rnk <= podium
    order by ranked.rnk, ranked.voters desc, ranked.ttext
  ) podium_block
  union all
  select * from (
    select
      ranked.rnk,
      ranked.tid,
      ranked.ttext,
      ranked.subm,
      ranked.pts,
      ranked.voters
    from ranked
    where ranked.rnk > podium
    order by ranked.rnk, ranked.voters desc, ranked.ttext
    limit runners
  ) runners_block;
end;
$$;
