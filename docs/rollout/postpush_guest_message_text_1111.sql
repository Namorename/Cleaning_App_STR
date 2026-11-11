-- After the push of 20261111140000 (docs/rollout/guest-message-text-1111.md): the head, the column and
-- the trigger of a task's link, the counter's table and who may touch it, every function the
-- migration made or replaced and who may execute each (proacl, not information_schema: the read role
-- sees it empty), and how many cards are tasks or carry a link. Read-only, counts and names only.
select json_build_object(
  'head', (select max(version) from supabase_migrations.schema_migrations),
  'link_column', (select count(*) from pg_attribute
                  where attrelid = 'public.signal_findings'::regclass and attname = 'task_link_ends'
                    and not attisdropped),
  'link_trigger', (select count(*) from pg_trigger
                   where tgrelid = 'public.signal_findings'::regclass and tgname = 'signal_findings_task_link'
                     and not tgisinternal),
  'counter_table', (select json_build_object(
                      'columns', (select string_agg(attname, ',' order by attnum) from pg_attribute
                                  where attrelid = c.oid and attnum > 0 and not attisdropped),
                      'grants', (select coalesce(string_agg(case when g.grantee = 0 then 'PUBLIC'
                                                                 else g.grantee::regrole::text end
                                                            || ':' || g.privilege_type, ',' order by 1), '-')
                                 from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g
                                 where g.grantee <> c.relowner))
                    from pg_class c where c.oid = 'raw.message_text_reads'::regclass),
  'functions', (
    select json_agg(json_build_object(
             'fn', p.oid::regprocedure::text,
             'definer', p.prosecdef,
             'volatile', p.provolatile,
             'exec', (select coalesce(string_agg(case when g.grantee = 0 then 'PUBLIC' else g.grantee::regrole::text end,
                                                 ',' order by 1), '-')
                      from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                      where g.privilege_type = 'EXECUTE' and g.grantee <> p.proowner))
           order by p.proname)
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('guest_message_target', 'take_message_text_read', 'signal_task_link_ends',
                        'signal_findings_task_link', 'cut_signal_stay_links', 'purge_signal_data',
                        'purge_guest_message_links')),
  'cut_knows_links', (select prosrc like '%signal_task_link_ends%' from pg_proc
                      where proname = 'cut_signal_stay_links' and pronamespace = 'public'::regnamespace),
  'cards_as_tasks', (select count(*) from public.signal_findings where status = 'task_created'),
  'cards_with_link', (select count(*) from public.signal_findings where task_link_ends is not null)
) as out;
