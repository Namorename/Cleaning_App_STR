-- Check of 20261030103000_kb_techs_read_all: technicians read the whole knowledge base
-- (docs/knowledge-base-step1.md, «Решение владельца 2026-10-31»). Read-only, one statement,
-- catalog only — no titles, no texts, no names. Run before the push (column, function and
-- policy absent) and right after:
--
--   node scripts/cloud-read.mjs docs/rollout/postpush_kb_techs_read_all.sql
--
-- Grants come from pg_proc.proacl through aclexplode, as in postpush_knowledge_base.sql
-- (information_schema shows the read-only role nothing).
--
-- Expected after the push, label by label:
--   head        20261030103000.
--   column      hosts.kb_techs_read_all: boolean, not null, default true.
--   functions   config {search_path=""}, definer true, one overload each; md5 prefix and length
--               of prosrc (2026-10-31, from a throwaway database with every migration of the
--               branch — recompute if the file changes, before the push, never after):
--                 kb_reader_property_ids   0977521f  1009   unchanged since 20261030100000
--                 kb_staff_article_ids     3e0b38e3   482   the body of 20261030103000
--                 kb_tech_reads_all        c436849a   208   new
--               execute (anon / authenticated / PUBLIC): ["authenticated"] for all three.
--   policies    kb_article_targets, all SELECT to {authenticated}; md5 prefix of the qual as
--               Postgres 17.6 prints it (the two old ones read so in the cloud on 2026-10-31):
--                 "field staff read their places of the articles they read"   a5dda625
--                 "office reads every place of an article"                     48241cec
--                 "technicians read every place of the articles they read"     bc59ee21
--
-- Before the push (read in the cloud on 2026-10-31): head 20261030100000, column [],
-- kb_staff_article_ids 1576bc36 / 434, kb_tech_reads_all absent, the first two policies.
--
-- The switch's values are one line of their own after the push (a column named in the query
-- is resolved before anything runs, so this probe would fail before it):
--   select kb_techs_read_all, count(*) from public.hosts group by 1;   -- expected: true | 1
select label, payload from (
  select 1 as ord, 'head' as label,
         to_jsonb((select max(version) from supabase_migrations.schema_migrations)) as payload

  union all
  select 2, 'column',
         (select coalesce(jsonb_agg(jsonb_build_object(
                   'type', format_type(a.atttypid, a.atttypmod),
                   'not_null', a.attnotnull,
                   'default', pg_get_expr(d.adbin, d.adrelid))), '[]'::jsonb)
          from pg_attribute a
          left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
          where a.attrelid = 'public.hosts'::regclass
            and a.attname = 'kb_techs_read_all' and not a.attisdropped)

  union all
  select 3, 'functions',
         (select jsonb_agg(jsonb_build_object(
                   'name', f.name,
                   'overloads', (select count(*) from pg_proc p2
                                 where p2.pronamespace = 'public'::regnamespace and p2.proname = f.name),
                   'md5', left(md5(p.prosrc), 8), 'len', length(p.prosrc),
                   'definer', p.prosecdef, 'config', p.proconfig,
                   'execute', (select coalesce(jsonb_agg(distinct
                                        case when a.grantee = 0 then 'PUBLIC'
                                             else a.grantee::regrole::text end), '[]'::jsonb)
                               from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                               where a.privilege_type = 'EXECUTE'
                                 and a.grantee in (0, 'anon'::regrole, 'authenticated'::regrole)))
                 order by f.name)
          from unnest(array['kb_reader_property_ids', 'kb_staff_article_ids',
                            'kb_tech_reads_all']) as f(name)
          left join pg_proc p
            on p.pronamespace = 'public'::regnamespace and p.proname = f.name)

  union all
  select 4, 'policies',
         (select jsonb_agg(jsonb_build_object('name', po.policyname, 'cmd', po.cmd, 'roles', po.roles,
                                              'qual_md5', left(md5(po.qual), 8))
                           order by po.policyname)
          from pg_policies po
          where po.schemaname = 'public' and po.tablename = 'kb_article_targets')
) checks
order by ord;
