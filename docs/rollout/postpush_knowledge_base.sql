-- Check of the knowledge base, step 1: 20261030100000_knowledge_base
-- (docs/knowledge-base-step1.md, «Выкат»). Read-only, one statement, catalog and counts
-- only — no titles, no texts, no names. Run before the push (everything empty) and right after:
--
--   node scripts/cloud-read.mjs docs/rollout/postpush_knowledge_base.sql
--
-- Grants come from pg_proc.proacl and pg_class.relacl through aclexplode (a function with no
-- ACL of its own reads its built-in default, acldefault) — information_schema shows the
-- read-only role nothing, and a check built on it passes without checking (CLAUDE.md).
--
-- Expected after the push, label by label:
--   head        20261030100000.
--   types       kb_scope [company, building, properties]; kb_status [draft, published, archived].
--   tables      the four kb_* tables, each: rls true; grants {"authenticated": "SELECT"} — nothing
--               for anon or PUBLIC; policies, all SELECT:
--                 kb_articles             "office reads every article",
--                                         "field staff read the published articles of their places"
--                 kb_article_targets      "office reads every place of an article",
--                                         "field staff read their places of the articles they read"
--                 kb_article_translations "office reads every translation",
--                                         "field staff read the translations of the articles they read"
--                 kb_article_revisions    "office reads every version"
--   functions   13 rows, overloads 1 each, config {search_path=""}; md5 prefix and length of
--               prosrc (2026-10-17, the file with sha256 40b50301ada9be2e… applied in a
--               rolled-back transaction on the local stand; a file with another sha256 —
--               recompute before the push, never after):
--                 kb_article_for_writer    dd0dd9eb   610  definer false
--                 kb_articles_snapshot     92d18ebd   199  definer false
--                 kb_articles_version      5a844e45   614  definer false
--                 kb_assert_publishable    3b880df4   394  definer false
--                 kb_checked_translations  d5efc163  2269  definer false
--                 kb_reader_property_ids   0977521f  1009  definer true
--                 kb_snapshot              9bb3049c   775  definer false
--                 kb_staff_article_ids     1576bc36   434  definer true
--                 kb_translations_version  c88e17fd   425  definer false
--                 kb_write_translations    11d57b5a   556  definer false
--                 restore_kb_revision      c7c1e606  1471  definer true
--                 save_kb_article          72d8f429  5433  definer true
--                 set_kb_article_status    ab5058b0   800  definer true
--               execute (anon / authenticated / PUBLIC): ["authenticated"] for the three writes
--               and the two readers' rules; [] for the other eight.
--   triggers    kb_articles_touch, kb_articles_version, kb_articles_snapshot on kb_articles,
--               kb_translations_version on kb_article_translations; enabled 'O', row true.
--
-- No row counts here: a table named in the query is resolved before anything runs, so the probe
-- would fail before the push. Counts after it are one line of their own (the doc, «После push»).
select label, payload from (
  select 1 as ord, 'head' as label,
         to_jsonb((select max(version) from supabase_migrations.schema_migrations)) as payload

  union all
  select 2, 'types',
         (select coalesce(jsonb_object_agg(t.typname, (select jsonb_agg(e.enumlabel order by e.enumsortorder)
                                                      from pg_enum e where e.enumtypid = t.oid)),
                          '{}'::jsonb)
          from pg_type t
          where t.typnamespace = 'public'::regnamespace and t.typname in ('kb_scope', 'kb_status'))

  union all
  select 3, 'tables',
         (select jsonb_agg(jsonb_build_object(
                   'table', n.name,
                   'exists', to_regclass('public.' || n.name) is not null,
                   'rls', (select c.relrowsecurity from pg_class c
                           where c.oid = to_regclass('public.' || n.name)),
                   'grants', (select coalesce(jsonb_object_agg(g.grantee, g.privileges), '{}'::jsonb)
                              from (select case when a.grantee = 0 then 'PUBLIC'
                                                else a.grantee::regrole::text end as grantee,
                                           string_agg(a.privilege_type, ',' order by a.privilege_type) as privileges
                                    from pg_class c
                                    cross join lateral aclexplode(c.relacl) a
                                    where c.oid = to_regclass('public.' || n.name)
                                      and a.grantee in (0, 'anon'::regrole, 'authenticated'::regrole)
                                    group by 1) g),
                   'policies', (select jsonb_agg(jsonb_build_object('name', po.policyname, 'cmd', po.cmd)
                                                 order by po.policyname)
                                from pg_policies po
                                where po.schemaname = 'public' and po.tablename = n.name))
                 order by n.name)
          from unnest(array['kb_articles', 'kb_article_targets', 'kb_article_translations',
                            'kb_article_revisions']) as n(name))

  union all
  select 4, 'functions',
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
          from unnest(array['kb_article_for_writer', 'kb_articles_snapshot', 'kb_articles_version',
                            'kb_assert_publishable', 'kb_checked_translations',
                            'kb_reader_property_ids', 'kb_snapshot', 'kb_staff_article_ids',
                            'kb_translations_version', 'kb_write_translations',
                            'restore_kb_revision', 'save_kb_article', 'set_kb_article_status']) as f(name)
          left join pg_proc p
            on p.pronamespace = 'public'::regnamespace and p.proname = f.name)

  union all
  select 5, 'triggers',
         (select jsonb_agg(jsonb_build_object('table', t.tgrelid::regclass::text, 'name', t.tgname,
                                              'enabled', t.tgenabled, 'row', (t.tgtype & 1) = 1)
                           order by t.tgname)
          from pg_trigger t
          where not t.tgisinternal
            and t.tgname in ('kb_articles_touch', 'kb_articles_version', 'kb_articles_snapshot',
                             'kb_translations_version'))
) checks
order by ord;
