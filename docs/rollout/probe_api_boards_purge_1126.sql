-- Probe after the db push of 20261126140000_api_boards and 20261126150000_archive_purge
-- (docs/rollout/boards-dates-chats-1126.md): who may execute each new or replaced function, the
-- grants of raw.task_media_orphans (pg_class.relacl, never information_schema under the read role),
-- the trigger on task_media and the two scopes. Read only: node scripts/cloud-read.mjs <this file>.
with fns as (
  select p.oid, p.proname
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('api_board_visible', 'api_board_column_name', 'api_board_json',
                      'api_board_card_json', 'api_v1_list_boards', 'api_v1_list_board_cards',
                      'api_v1_create_board_card', 'queue_orphaned_media', 'task_media_to_purge',
                      'mark_task_media_purged', 'delete_archived_board', 'delete_shelved_board_card',
                      'delete_archived_problem')
)
select 'function' as kind,
       f.proname as name,
       coalesce((select string_agg(distinct case when a.grantee = 0 then 'PUBLIC' else r.rolname end, ',')
                 from pg_proc p
                 cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 left join pg_roles r on r.oid = a.grantee
                 where p.oid = f.oid and a.privilege_type = 'EXECUTE'
                   and coalesce(r.rolname, 'PUBLIC') in ('PUBLIC', 'anon', 'authenticated', 'service_role')),
                '-') as detail
from fns f
union all
select 'table', 'raw.task_media_orphans',
       coalesce((select string_agg(distinct case when a.grantee = 0 then 'PUBLIC' else r.rolname end
                                            || ':' || a.privilege_type, ',')
                 from pg_class c
                 cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                 left join pg_roles r on r.oid = a.grantee
                 where c.oid = to_regclass('raw.task_media_orphans')
                   and coalesce(r.rolname, 'PUBLIC') in ('PUBLIC', 'anon', 'authenticated', 'service_role')),
                case when to_regclass('raw.task_media_orphans') is null then 'absent' else '-' end)
union all
select 'trigger', t.tgname::text, pg_get_triggerdef(t.oid)
from pg_trigger t
where t.tgrelid = 'public.task_media'::regclass and t.tgname = 'task_media_queue_orphan'
union all
select 'scope', s.id, s.sensitivity || '/' || s.status || '/operator=' || s.operator
from public.api_scopes s
where s.id in ('boards:read', 'boards:create_cards')
order by 1, 2;
