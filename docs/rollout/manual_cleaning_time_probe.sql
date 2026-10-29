-- A manager's time of a booking's cleaning (20261027120000, docs/manual-cleaning-time.md):
-- before and after the push, and after a rollback. Read-only, one statement, counts only —
-- no ids, no names. Runs the same before the migration (the columns are read through
-- to_jsonb, the functions through to_regprocedure, so nothing it names has to exist).
--
--   node scripts/cloud-read.mjs docs/rollout/manual_cleaning_time_probe.sql
--
-- bodies: the first 8 hex of md5(prosrc) of the functions the migration changes and adds;
-- the «before» and «after» values are in the doc, §8. cleanings: the cleanings from today
-- on, and how many carry a manager's time or the mark of a lost one.
select json_build_object(
  'head', (select max(m.version) from supabase_migrations.schema_migrations m),
  'recorded', (select count(*) from supabase_migrations.schema_migrations m
               where m.version = '20261027120000'),
  'bodies', (select json_object_agg(p.proname, left(md5(p.prosrc), 8) order by p.proname)
             from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public'
               and p.proname in ('generate_cleaning_tasks', 'save_task', 'guard_task_fields',
                                 'cleaning_turnover_on', 'set_cleaning_time',
                                 'clear_cleaning_time', 'lock_cleaning_for_time',
                                 'journal_cleaning_time')),
  'columns', (select coalesce(json_agg(a.attname order by a.attname), '[]'::json)
              from pg_attribute a
              where a.attrelid = 'public.tasks'::regclass
                and a.attname in ('manual_time_on', 'manual_time_lost_on')
                and not a.attisdropped),
  'triggers', (select coalesce(json_agg(t.tgname order by t.tgname), '[]'::json)
               from pg_trigger t
               where t.tgrelid = 'public.tasks'::regclass
                 and t.tgname in ('tasks_journal_cleaning_insert_time',
                                  'tasks_journal_cleaning_update_time')),
  'event_kinds', (select coalesce(json_agg(e.enumlabel order by e.enumsortorder), '[]'::json)
                  from pg_enum e
                  join pg_type ty on ty.oid = e.enumtypid
                  where ty.typname = 'task_event_kind'
                    and e.enumlabel in ('time_set', 'time_auto', 'time_dropped')),
  -- Who may call the two RPCs: authenticated yes, anon no (null: not there).
  'execute', json_build_object(
    'set_authenticated', (select has_function_privilege('authenticated', f, 'execute')
                          from to_regprocedure('public.set_cleaning_time(uuid,time,time,date)') f
                          where f is not null),
    'set_anon', (select has_function_privilege('anon', f, 'execute')
                 from to_regprocedure('public.set_cleaning_time(uuid,time,time,date)') f
                 where f is not null),
    'clear_authenticated', (select has_function_privilege('authenticated', f, 'execute')
                            from to_regprocedure('public.clear_cleaning_time(uuid,date)') f
                            where f is not null),
    'clear_anon', (select has_function_privilege('anon', f, 'execute')
                   from to_regprocedure('public.clear_cleaning_time(uuid,date)') f
                   where f is not null)),
  'cleanings', (select json_build_object(
      'from_today', count(*),
      'open', count(*) filter (where t.status in ('unassigned', 'assigned', 'accepted')),
      'open_from_booking', count(*) filter (where t.status in ('unassigned', 'assigned', 'accepted')
                                              and t.reservation_id is not null),
      'open_by_hand', count(*) filter (where t.status in ('unassigned', 'assigned', 'accepted')
                                         and t.reservation_id is null),
      'manual_time', count(*) filter (where to_jsonb(t) ->> 'manual_time_on' is not null),
      'manual_time_lost', count(*) filter (where to_jsonb(t) ->> 'manual_time_lost_on' is not null))
    from public.tasks t
    where t.type = 'cleaning' and t.scheduled_date >= current_date)
) as manual_cleaning_time;
