-- The pushes settled in the last ten minutes, by outcome: the new send-push runs cleanly.
select coalesce(json_agg(x), '[]'::json) as outcomes from (
  select outcome, count(*) as n from raw.push_outbox
  where settled_at > now() - interval '10 minutes' group by outcome
) x;
