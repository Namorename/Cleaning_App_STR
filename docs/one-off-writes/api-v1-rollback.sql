-- Rollback of 20261028100000_public_api_v1 (docs/api-v1.md §13).
--
-- Cloud: only on the owner's word, after the functions api and api-keys are
-- taken down (otherwise they answer 500 on every call). Then remove the row of
-- 20261028100000 from supabase_migrations.schema_migrations in the same window,
-- or the next `db push` will not re-apply it.
-- Local stand: `node scripts/api-stand.mjs down`.
--
-- Everything the migration made goes, the keys and the request log with it:
-- a key made before the rollback does not survive a re-apply.
begin;

select cron.unschedule('purge-api-records')
where exists (select 1 from cron.job where jobname = 'purge-api-records');

do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and (p.proname like 'api\_%' or p.proname in ('create_api_key', 'list_api_keys',
           'update_api_key', 'revoke_api_key', 'list_api_key_events'))
  loop
    execute format('drop function %s', v_fn);
  end loop;
end $$;

drop table public.api_idempotency;
drop table public.api_rate_windows;
drop table public.api_request_log;
drop table public.api_key_events;
drop table public.api_keys;
drop table public.api_scopes;
drop type public.api_context;

notify pgrst, 'reload schema';

commit;
