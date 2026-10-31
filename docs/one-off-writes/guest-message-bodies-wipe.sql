-- One-off wipe of the guest message texts already stored in raw.webhook_events
-- (docs/guest-signals-intake.md §4; owner's decision 4 of 2026-10-31, docs/guest-signals.md §10).
-- A WRITE to the cloud: only on the owner's separate word; never in 03:00–04:40 UTC
-- (purge-webhook-events deletes old rows at 03:50).
--
-- Every message notification (object_type like '%message%', or event_type 'message.*' /
-- 'conversation*' — the same test as isGuestMessageEvent in
-- supabase/functions/hostaway-webhook/guest-message.ts) keeps only what the intake keeps since
-- that change, scalar values only:
--   top level  object, event, objectId, accountId
--   data       id, conversationId, reservationId, listingMapId, isIncoming, communicationType,
--              channelId, date, insertedOn, updatedOn, sentChannelDate, listingTimeZoneName
-- A body that did not parse and looks like a message keeps only its length (journalUnparsed).
-- Reservation and all other notifications are not touched: the statement selects message rows only.
-- The lists below are kept equal to guest-message.ts by guest-message.test.ts.
--
-- NO WAY BACK: the texts are gone for good. If one is ever needed, it is read again from Hostaway
-- by GET conversations/{data.conversationId}/messages — the kept ids point to it.
--
-- Order (docs/guest-signals-intake.md §4):
--   1. the new intake is deployed and the probe shows events without text — otherwise new texts
--      keep arriving after the wipe;
--   2. the probe before: node scripts/cloud-read.mjs docs/rollout/guest_message_intake_probe.sql
--   3. this file, one statement:
--        npx supabase db query --linked -f docs/one-off-writes/guest-message-bodies-wipe.sql
--   4. the probe after: not_minimal 0, with_body 0, reservation rows as before.
--
-- The statement answers with its own counters: message_events and with_body_before are read
-- before the update; wiped is what it changed; text_left_in_wiped must be 0. Run twice, the
-- second run wipes 0 (idempotent).
with keep_top(k) as (
  values ('object'), ('event'), ('objectId'), ('accountId')
),
keep_data(k) as (
  values ('id'), ('conversationId'), ('reservationId'), ('listingMapId'), ('isIncoming'),
         ('communicationType'), ('channelId'), ('date'), ('insertedOn'), ('updatedOn'),
         ('sentChannelDate'), ('listingTimeZoneName')
),
message_events as (
  select e.id, e.payload
  from raw.webhook_events e
  where e.object_type ~* 'message' or e.event_type ~* '^(message|conversation)'
),
unparsed_messages as (
  select e.id, e.payload
  from raw.webhook_events e
  where e.payload ? 'unparsed'
    and coalesce(e.payload ->> 'unparsed', '') ~* 'conversationMessage|message\.received'
),
minimal as (
  select m.id,
         coalesce((select jsonb_object_agg(t.key, t.value)
                   from jsonb_each(m.payload) t
                   where t.key in (select k from keep_top)
                     and jsonb_typeof(t.value) not in ('object', 'array')), '{}'::jsonb)
         || case when jsonb_typeof(m.payload -> 'data') = 'object'
                 then jsonb_build_object('data',
                        coalesce((select jsonb_object_agg(d.key, d.value)
                                  from jsonb_each(m.payload -> 'data') d
                                  where d.key in (select k from keep_data)
                                    and jsonb_typeof(d.value) not in ('object', 'array')), '{}'::jsonb))
                 else '{}'::jsonb
            end as payload
  from message_events m
  where jsonb_typeof(m.payload) = 'object'
  union all
  select u.id,
         jsonb_build_object('unparsed', null,
                            'unparsedLength', length(u.payload ->> 'unparsed'),
                            'contentType', u.payload -> 'contentType',
                            'withheld', 'guest_message')
  from unparsed_messages u
),
changed as (
  select mi.id, mi.payload
  from minimal mi
  join raw.webhook_events e on e.id = mi.id
  where e.payload is distinct from mi.payload
),
wiped as (
  update raw.webhook_events e
  set payload = c.payload
  from changed c
  where e.id = c.id
  returning e.id, e.payload
)
select
  (select count(*) from message_events) as message_events,
  (select count(*) from message_events where payload -> 'data' ? 'body') as with_body_before,
  (select count(*) from unparsed_messages) as unparsed_messages,
  (select count(*) from changed) as to_wipe,
  (select count(*) from wiped) as wiped,
  (select count(*) from wiped
    where payload -> 'data' ? 'body' or payload ->> 'unparsed' is not null) as text_left_in_wiped,
  (select count(*) from raw.webhook_events where object_type = 'reservation') as reservation_rows;
