-- dashboard probe H: supplies, event history kept in raw.*, chat, duplicates and sensitive raw keys (counts only)
select json_build_object(
  'supply_by_status_priority', (select json_object_agg(k, n) from (
      select status::text || '/' || priority::text as k, count(*) as n from public.supply_requests group by 1) s),
  'supply_fill', (select json_build_object('reviewed_at', count(reviewed_at), 'fulfilled_at', count(fulfilled_at),
      'needed_by', count(needed_by), 'task_id', count(task_id), 'property_id', count(property_id),
      'reject_reason', count(*) filter (where coalesce(reject_reason, '') <> ''),
      'range', json_build_array(min(created_at)::date, max(created_at)::date)) from public.supply_requests),
  'supply_items', (select count(*) from public.supply_request_items),
  'supply_items_from_catalog', (select count(catalog_item_id) from public.supply_request_items),
  'catalog_items', (select count(*) from public.supply_catalog_items),
  'outbox_by_kind', (select json_object_agg(kind, json_build_array(n, d0, d1)) from (
      select kind::text as kind, count(*) as n, min(created_at)::date as d0, max(created_at)::date as d1
      from raw.push_outbox group by 1) o),
  'outbox_outcomes', (select json_object_agg(coalesce(outcome, 'pending'), n) from (
      select outcome, count(*) as n from raw.push_outbox group by 1) oo),
  'push_tickets', (select json_build_array(count(*), min(created_at)::date, max(created_at)::date) from raw.push_tickets),
  'webhooks_by_type', (select json_object_agg(t, json_build_array(n, d0, d1)) from (
      select coalesce(object_type, '?') || '/' || coalesce(event_type, '?') as t, count(*) as n,
             min(received_at)::date as d0, max(received_at)::date as d1
      from raw.webhook_events group by 1) w),
  'generator_runs', (select json_build_array(count(*), min(ran_at)::date, max(ran_at)::date) from raw.generator_runs),
  'chat_threads_by_kind', (select json_object_agg(kind, n) from (select kind::text as kind, count(*) as n from public.chat_threads group by 1) c),
  'chat_messages', (select json_build_array(count(*), min(created_at)::date, max(created_at)::date) from public.chat_messages),
  'dupe_live_cleanings_same_property_day', (select count(*) from (
      select property_id, scheduled_date from public.tasks
      where type = 'cleaning' and status <> 'cancelled' group by 1, 2 having count(*) > 1) d),
  'tasks_titled_test', (select count(*) from public.tasks where title ilike '%test%' or title ilike '%тест%'),
  'properties_named_test', (select count(*) from public.properties where name ilike '%test%' or name ilike '%тест%'),
  'raw_sensitive_keys_non_empty', (select json_build_object(
      'ccNumber', count(*) filter (where coalesce(data->>'ccNumber', '') <> ''),
      'cvc', count(*) filter (where coalesce(data->>'cvc', '') <> ''),
      'doorCode', count(*) filter (where coalesce(data->>'doorCode', '') <> ''),
      'guestEmail', count(*) filter (where coalesce(data->>'guestEmail', '') <> ''),
      'phone', count(*) filter (where coalesce(data->>'phone', '') <> '')) from raw.hostaway_reservations),
  'raw_useful_keys_non_empty', (select json_build_object(
      'reservationDate', count(*) filter (where coalesce(data->>'reservationDate', '') <> ''),
      'cancellationDate', count(*) filter (where coalesce(data->>'cancellationDate', '') <> ''),
      'previousDepartureDate', count(*) filter (where coalesce(data->>'previousDepartureDate', '') <> ''),
      'nights', count(*) filter (where coalesce(data->>'nights', '') <> ''),
      'channelName', count(*) filter (where coalesce(data->>'channelName', '') <> ''),
      'currency_distinct', count(distinct data->>'currency')) from raw.hostaway_reservations)
) as probe;
