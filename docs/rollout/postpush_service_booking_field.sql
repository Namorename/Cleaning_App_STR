-- Post-push check for 20260926140000_service_booking_field (docs/f10-plan.md,
-- §2, option a). Read-only, one statement, catalog only:
--
--   node scripts/cloud-read.mjs docs/rollout/postpush_service_booking_field.sql
--
-- Expected, label by label:
--   head        20260926140000.
--   overloads   exactly two rows, both owner postgres, volatility i, config
--               {search_path=""}, ACL {postgres=X/postgres,authenticated=X/postgres,
--               service_role=X/postgres}; md5 prefix / length (local stack, 2026-09-26):
--                 is_service_booking(text)          e0aedd90 63  — unchanged from step 1
--                 is_service_booking(reservations)  7b96b090 56  — the new field
--   anon        false for both. Any true is a stop.
--   public      false for both: PUBLIC holds no EXECUTE on functions of ours
--               since 20260926100000.
--
-- ROLLBACK. There is no down migration: a later forward migration
-- `drop function public.is_service_booking(public.reservations);`, and only
-- once no deployed panel build selects the field — a select naming a missing
-- computed field answers 42703 and empties the calendar. Always name the
-- argument type: the bare name is ambiguous now. The text rule stays either
-- way, so dropping the field never changes what the generator does.
select label, payload from (
  select 1 as ord, 'head' as label,
         to_jsonb((select max(version) from supabase_migrations.schema_migrations)) as payload
  union all
  select 2, 'overloads',
         (select jsonb_agg(jsonb_build_object(
                   'signature', p.oid::regprocedure::text,
                   'md5', left(md5(p.prosrc), 8), 'len', length(p.prosrc),
                   'owner', p.proowner::regrole::text, 'volatility', p.provolatile::text,
                   'config', p.proconfig, 'acl', p.proacl::text)
                   order by p.oid::regprocedure::text)
            from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname = 'is_service_booking')
  union all
  select 3, 'anon',
         (select jsonb_object_agg(p.oid::regprocedure::text,
                                  has_function_privilege('anon', p.oid, 'execute'))
            from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname = 'is_service_booking')
  union all
  select 4, 'public',
         (select jsonb_object_agg(p.oid::regprocedure::text,
                                  exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                           where a.grantee = 0))
            from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname = 'is_service_booking')
) t order by ord
