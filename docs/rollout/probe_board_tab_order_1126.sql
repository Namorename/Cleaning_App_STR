-- Probe of 20261126160000_board_tab_order (docs/rollout/board-tab-order-1126.md): the head, the
-- table's grants (pg_class.relacl through aclexplode — never information_schema under the read
-- role), RLS, its policies, and who may execute the two functions. One row; read only:
-- node scripts/cloud-read.mjs docs/rollout/probe_board_tab_order_1126.sql
select
  (select max(version) from supabase_migrations.schema_migrations) as head,
  (select coalesce(string_agg(distinct case when a.grantee = 0 then 'PUBLIC' else r.rolname end
                                       || ':' || a.privilege_type, ','), '-')
   from pg_class c
   cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
   left join pg_roles r on r.oid = a.grantee
   where c.oid = to_regclass('public.board_tab_orders')
     and coalesce(r.rolname, 'PUBLIC') in ('PUBLIC', 'anon', 'authenticated')) as table_grants,
  (select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.board_tab_orders')) as rls,
  (select string_agg(p.polname || ' ' || p.polcmd::text || ' '
                     || md5(coalesce(pg_get_expr(p.polqual, p.polrelid), '') || '|'
                            || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')),
                     '; ' order by p.polname)
   from pg_policy p where p.polrelid = to_regclass('public.board_tab_orders')) as policies,
  (select string_agg(f.proname || ' ' || f.prosecdef::text || ' ' || md5(f.prosrc) || ' '
                     || coalesce((select string_agg(distinct case when a.grantee = 0 then 'PUBLIC'
                                                                  else r.rolname end, '/')
                                  from aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a
                                  left join pg_roles r on r.oid = a.grantee
                                  where a.privilege_type = 'EXECUTE'
                                    and coalesce(r.rolname, 'PUBLIC') in ('PUBLIC', 'anon', 'authenticated')),
                                 '-'),
                     '; ' order by f.proname)
   from pg_proc f
   where f.pronamespace = 'public'::regnamespace
     and f.proname in ('board_tab_ids_valid', 'save_board_tab_order')) as functions,
  (select count(*) from pg_constraint
   where conrelid = to_regclass('public.board_tab_orders') and contype in ('c', 'f', 'p')) as constraints;
