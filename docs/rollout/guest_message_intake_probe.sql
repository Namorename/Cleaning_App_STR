-- Check of the guest message intake (docs/guest-signals-intake.md): do message notifications in
-- raw.webhook_events hold only the kept fields? Read-only, one statement, counts and times only —
-- never a text, a name or an id:
--
--   node scripts/cloud-read.mjs docs/rollout/guest_message_intake_probe.sql
--
-- A message row is "minimal" when it holds only the kept keys with scalar values (the lists of
-- supabase/functions/hostaway-webhook/guest-message.ts; guest-message.test.ts keeps them equal).
--
-- Expected (docs/guest-signals-intake.md §5):
--   before the deploy   not_minimal = message_events, with_body = message_events, minimal_events 0
--   after the deploy    first_minimal_at just after the deploy, last_not_minimal_at before it;
--                       new events only add to minimal_events
--   after the wipe      not_minimal 0, with_body 0, unparsed kept_text 0
--   always              reservation_last_24h: only processed (pending for at most one run);
--                       message_status: skipped (pending for at most one run)
with keep_top(k) as (
  values ('object'), ('event'), ('objectId'), ('accountId')
),
keep_data(k) as (
  values ('id'), ('conversationId'), ('reservationId'), ('listingMapId'), ('isIncoming'),
         ('communicationType'), ('channelId'), ('date'), ('insertedOn'), ('updatedOn'),
         ('sentChannelDate'), ('listingTimeZoneName')
),
msg as (
  select e.status, e.received_at, e.payload
  from raw.webhook_events e
  where e.object_type ~* 'message' or e.event_type ~* '^(message|conversation)'
),
judged as (
  select m.status, m.received_at, m.payload ? 'data' and m.payload -> 'data' ? 'body' as has_body,
         exists (select 1 from jsonb_each(m.payload) t
                 where (t.key = 'data' and jsonb_typeof(t.value) <> 'object')
                    or (t.key <> 'data' and (t.key not in (select k from keep_top)
                                             or jsonb_typeof(t.value) in ('object', 'array'))))
         or (jsonb_typeof(m.payload -> 'data') = 'object'
             and exists (select 1 from jsonb_each(m.payload -> 'data') d
                         where d.key not in (select k from keep_data)
                            or jsonb_typeof(d.value) in ('object', 'array'))) as not_minimal
  from msg m
)
select label, value from (
  select 1 as ord, 'message_events' as label, to_jsonb(count(*)) as value from judged
  union all
  select 2, 'not_minimal', to_jsonb(count(*) filter (where not_minimal)) from judged
  union all
  select 3, 'with_body', to_jsonb(count(*) filter (where has_body)) from judged
  union all
  select 4, 'minimal_events', to_jsonb(count(*) filter (where not not_minimal)) from judged
  union all
  select 5, 'last_not_minimal_at', to_jsonb(max(received_at) filter (where not_minimal)) from judged
  union all
  select 6, 'first_minimal_at', to_jsonb(min(received_at) filter (where not not_minimal)) from judged
  union all
  select 7, 'message_status',
         coalesce((select jsonb_object_agg(s.status, s.n)
                   from (select status::text as status, count(*) as n from judged group by 1) s), '{}'::jsonb)
  union all
  select 8, 'unparsed',
         jsonb_build_object(
           'kept_text', count(*) filter (where e.payload ->> 'unparsed' is not null),
           'withheld', count(*) filter (where e.payload ->> 'withheld' = 'guest_message'))
  from raw.webhook_events e
  where e.payload ? 'unparsed'
  union all
  select 9, 'reservation_last_24h',
         coalesce((select jsonb_object_agg(s.status, s.n)
                   from (select status::text as status, count(*) as n
                         from raw.webhook_events
                         where object_type = 'reservation' and received_at > now() - interval '24 hours'
                         group by 1) s), '{}'::jsonb)
) checks
order by ord;
