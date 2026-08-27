-- Scheduled jobs: webhook journal processing, reservation reconciliation,
-- and the daily listing sync.
--
-- Edge Functions are invoked over HTTP from the database, so both pg_cron
-- (scheduling) and pg_net (outbound HTTP) are required.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

/**
 * Invoke an Edge Function by name.
 *
 * The base URL and the service key live in Vault rather than in this
 * migration: they differ between local and hosted environments, and the key
 * must never be committed. Insert them once per environment:
 *
 *   select vault.create_secret('http://host.docker.internal:54321', 'edge_function_base_url');
 *   select vault.create_secret('<service-role-key>', 'edge_function_key');
 *
 * Returns the pg_net request id. pg_net is fire-and-forget: the response
 * lands in net._http_response asynchronously, so a job that returns an id
 * has been dispatched, not necessarily completed.
 */
create or replace function public.invoke_edge_function(function_name text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base_url text;
  v_key      text;
  v_request  bigint;
begin
  select decrypted_secret into v_base_url
  from vault.decrypted_secrets where name = 'edge_function_base_url';

  select decrypted_secret into v_key
  from vault.decrypted_secrets where name = 'edge_function_key';

  -- Fail loudly. A scheduled job that silently does nothing is worse than
  -- one that errors: the error is visible in cron.job_run_details.
  if v_base_url is null or v_key is null then
    raise exception
      'Vault secrets edge_function_base_url / edge_function_key are not set; % was not invoked',
      function_name;
  end if;

  select net.http_post(
    url     := v_base_url || '/functions/v1/' || function_name,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := '{}'::jsonb,
    -- Reconciliation walks seven pages of Hostaway data; the default 5 s
    -- would abort it mid-flight.
    timeout_milliseconds := 120000
  ) into v_request;

  return v_request;
end;
$$;

revoke all on function public.invoke_edge_function(text) from public, anon, authenticated;
grant execute on function public.invoke_edge_function(text) to service_role;

/**
 * Schedules.
 *
 * The journal runs often: a webhook that is not processed delays the cleaning
 * task. The two syncs run at night — they are safety nets, not the primary
 * path, and they touch the Hostaway rate limit.
 *
 * cron.schedule is idempotent by job name, so re-running this migration
 * updates the schedule instead of creating duplicates.
 */
select cron.schedule(
  'process-webhook-events',
  '*/2 * * * *',
  $$select public.invoke_edge_function('process-webhook-events')$$
);

select cron.schedule(
  'sync-listings-daily',
  '0 3 * * *',
  $$select public.invoke_edge_function('sync-listings')$$
);

-- Runs after the listing sync: a reservation for a brand-new listing needs
-- its property row to exist first, otherwise it is deferred.
select cron.schedule(
  'sync-reservations-daily',
  '15 3 * * *',
  $$select public.invoke_edge_function('sync-reservations')$$
);
