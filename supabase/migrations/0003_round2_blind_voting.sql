-- Round-2 blind voting
--
-- The Round 2 ballot UI no longer shows "Submitted by …" on each card. To
-- match the column-hide pattern used in Round 1 (where `topics.submitter` is
-- excluded from the `authenticated` table grant and only surfaced via
-- phase-gated SECURITY DEFINER RPCs), we strip `submitter` from
-- `get_round2_ballot`'s return so the value never crosses the wire to a
-- voter during Round 2.
--
-- `get_results` continues to return `submitter` because the results phase
-- intentionally credits each topic's author.
--
-- Note: Postgres does not allow CREATE OR REPLACE to change a function's
-- return columns, so we DROP first.

drop function if exists public.get_round2_ballot(uuid);

create or replace function public.get_round2_ballot(p_session_id uuid)
returns table (
  topic_id   uuid,
  topic_text text
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
  select distinct t.id, t.topic_text
  from public.topics t
  join public.round1_votes r on r.topic_id = t.id
  where t.session_id = p_session_id
    and t.removed = false
  order by t.topic_text;
end;
$$;

revoke all on function public.get_round2_ballot(uuid) from public;
grant execute on function public.get_round2_ballot(uuid) to authenticated;
