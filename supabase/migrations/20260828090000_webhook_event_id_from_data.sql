-- Read the object id from the real Hostaway payload shape.
--
-- Found by production traffic, not by tests. The documented example log entry
-- has a flat `objectId` field, so record_webhook_event looked for that. Live
-- deliveries carry a different shape:
--
--   {
--     "object":    "reservation",
--     "event":     "reservation.updated",
--     "accountId": 37874,
--     "data":      { "id": 65039268, ... full reservation ... }
--   }
--
-- There is no `objectId` at all — the id lives at `data.id`. The extraction
-- returned null, so every real reservation event was classified as
-- uninteresting and skipped: reservations were silently lost.
--
-- Both shapes are accepted now. `objectId` stays first because that is what
-- the documentation describes and what the tests use; `data.id` is the
-- fallback that live traffic actually needs.
--
-- Note that `data` holds the full reservation including guest phone and name.
-- That is another reason the journal lives in the raw schema, which is not
-- exposed through PostgREST.

create or replace function public.record_webhook_event(
  event_payload jsonb,
  event_source  text default 'hostaway'
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id        bigint;
  v_object_id text;
begin
  v_object_id := coalesce(
    nullif(event_payload ->> 'objectId', ''),
    nullif(event_payload -> 'data' ->> 'id', '')
  );

  insert into raw.webhook_events (source, object_type, object_id, event_type, payload)
  values (
    event_source,
    nullif(event_payload ->> 'object', ''),
    -- Guard the cast: an unexpected shape must not reject the delivery.
    -- Losing the id is recoverable from the stored payload; losing the whole
    -- notification is not, and Hostaway does not retry after a 4xx.
    case when v_object_id ~ '^[0-9]+$' then v_object_id::bigint end,
    nullif(event_payload ->> 'event', ''),
    event_payload
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_webhook_event(jsonb, text) from public, anon, authenticated;
grant execute on function public.record_webhook_event(jsonb, text) to service_role;

-- Recover rows already stored with a null id, and put reservation events that
-- were wrongly skipped back into the queue.
update raw.webhook_events
set object_id = (payload -> 'data' ->> 'id')::bigint
where object_id is null
  and payload -> 'data' ->> 'id' ~ '^[0-9]+$';

update raw.webhook_events
set status = 'pending',
    processed_at = null,
    attempts = 0,
    last_error = null
where status = 'skipped'
  and object_type = 'reservation'
  and object_id is not null;
