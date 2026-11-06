-- Texts without the guest notice (20261102100000, docs/rollout-plan-1028.md §9.8): the
-- cloud before and after the push, and after a rollback. Catalog and counts only: one
-- statement, static SQL, valid in every state; no row of a guest, no text, no date.
--
--   node scripts/cloud-read.mjs <plan tree>/docs/rollout/postpush_texts_boundary_1102.sql
--
-- head           the newest migration applied;
-- since_1030     the versions of 30.10 and later, in order;
-- columns        signal_settings' two dates of the texts' line, with their types;
-- checks         every check of signal_settings (the catalog fingerprint does not see checks):
--                texts_need_notice before, texts_have_a_line after;
-- functions      md5 of the three bodies the step replaces (review_text_allowed,
--                cut_signal_stay_links, update_signal_settings);
-- refusal        whether update_signal_settings still refuses the reviews' texts without the
--                notice (its message of 20261030110000);
-- message_refusal whether it refuses the messages' texts without the notice (20261102100000:
--                they keep their gate);
-- exec           who may execute the three: PUBLIC, anon, authenticated, service_role;
-- client_grants  what PUBLIC, anon and authenticated hold on signal_settings (pg_class.relacl);
-- settings       how many rows of switches and how many of each switch is on (all 0 before
--                the owner's word of 5e);
-- jobs_on        which of the two guest cron jobs are active (none before 5e).
select json_build_object(
  'head', (select max(version) from supabase_migrations.schema_migrations),
  'since_1030', (select json_agg(version order by version)
                 from supabase_migrations.schema_migrations where version >= '20261030000000'),
  'columns', (select coalesce(json_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
                                       || case when a.attnotnull then ' not null' else '' end
                                       order by a.attname), '[]'::json)
              from pg_attribute a
              where a.attrelid = 'public.signal_settings'::regclass and a.attnum > 0 and not a.attisdropped
                and a.attname in ('notice_published_at', 'texts_enabled_at')),
  'checks', (select json_agg(c.conname || ': ' || pg_get_constraintdef(c.oid) order by c.conname)
             from pg_constraint c
             where c.conrelid = 'public.signal_settings'::regclass and c.contype = 'c'),
  'functions', (select json_object_agg(p.proname, left(md5(replace(p.prosrc, chr(13), '')), 8) order by p.proname)
                from pg_proc p
                where p.pronamespace = 'public'::regnamespace
                  and p.proname in ('review_text_allowed', 'cut_signal_stay_links', 'update_signal_settings')),
  'refusal', (select position('Texts need the published guest notice' in p.prosrc) > 0
              from pg_proc p
              where p.oid = to_regprocedure('public.update_signal_settings(boolean, boolean, boolean, boolean, text[], integer, numeric, timestamptz, integer, public.guest_signal_kind)')),
  'message_refusal', (select position('Texts of messages need the published guest notice' in p.prosrc) > 0
                      from pg_proc p
                      where p.oid = to_regprocedure('public.update_signal_settings(boolean, boolean, boolean, boolean, text[], integer, numeric, timestamptz, integer, public.guest_signal_kind)')),
  'exec', (select json_agg(x order by x) from (
      select p.proname || ' ' || case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as x
      from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.pronamespace = 'public'::regnamespace
        and p.proname in ('review_text_allowed', 'cut_signal_stay_links', 'update_signal_settings')
        and a.privilege_type = 'EXECUTE'
        and (a.grantee = 0 or a.grantee in ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole))) t),
  'client_grants', (select coalesce(json_agg(x order by x), '[]'::json) from (
      select c.relname || ' ' || case when g.grantee = 0 then 'PUBLIC' else g.grantee::regrole::text end
             || ' ' || g.privilege_type as x
      from pg_class c
      cross join lateral aclexplode(c.relacl) g
      where c.oid = 'public.signal_settings'::regclass
        and (g.grantee = 0 or g.grantee in ('anon'::regrole, 'authenticated'::regrole))) t),
  'settings', (select json_build_object(
                        'rows', count(*),
                        'sync_on', count(*) filter (where sync_enabled),
                        'texts_on', count(*) filter (where texts_enabled),
                        'tasks_on', count(*) filter (where tasks_enabled),
                        'model_on', count(*) filter (where model_enabled),
                        'notice_dated', count(*) filter (where notice_published_at is not null))
               from public.signal_settings),
  'jobs_on', (select coalesce(json_agg(jobname order by jobname), '[]'::json)
              from cron.job
              where jobname in ('sync-guest-signals-daily', 'classify-guest-signals-daily') and active)
) as postpush_texts_boundary;
