-- Table privileges of the client roles, stated once for every relation.
-- Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected: row level security filters rows inside the
-- privileges a role holds, and two of the privileges the platform hands out
-- by default are not subject to it at all — TRUNCATE empties a table whatever
-- the policies say, and TRIGGER lets a role attach code to someone else's
-- writes. Both were found on `authenticated` in the cloud on 2026-09-07,
-- on every table older than F16, because hosted Supabase grants the whole
-- set to new tables through default privileges and a `grant select` does not
-- take anything back.
--
-- This suite is the matrix: each relation in `public` names exactly what
-- `authenticated` may do with it, `anon` may do nothing, and the default
-- privileges no longer hand anything to either. A relation missing from the
-- matrix fails the suite on purpose — a new table is not done until someone
-- has decided its grants here.
begin;

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $$;

-- ---------- what authenticated is meant to have ----------
--
-- Full DML only where a policy lets a manager write the table directly;
-- everything written through RPC (task steps, checklists, templates) and the
-- company row are read-only. The view is read-only by nature.
create temp table wanted (relation text primary key, privs text not null);
insert into wanted values
  -- Everything a person says is written through send_message, so the
  -- tables themselves are read-only to a client. A thread is opened by
  -- open_thread and its tail is kept by a trigger; a read marker moves
  -- only forward, and only through mark_thread_read.
  ('chat_threads',         'SELECT'),
  ('chat_messages',        'SELECT'),
  ('chat_reads',           'SELECT'),
  ('profiles',             'DELETE,INSERT,SELECT,UPDATE'),
  ('properties',           'DELETE,INSERT,SELECT,UPDATE'),
  ('reservations',         'DELETE,INSERT,SELECT,UPDATE'),
  -- Written by the sync alone: the rows copy what Hostaway said about
  -- which room a booking took, and a hand-edit would be overwritten in
  -- the night.
  ('reservation_units',    'SELECT'),
  ('property_cleaners',    'DELETE,INSERT,SELECT,UPDATE'),
  -- The office's note on a property: the panel writes it directly, and only
  -- a manager of the property's company passes the policy.
  ('property_internal_notes', 'DELETE,INSERT,SELECT,UPDATE'),
  ('tasks',                'DELETE,INSERT,SELECT,UPDATE'),
  ('hosts',                'SELECT'),
  ('workflow_templates',   'SELECT'),
  ('workflow_steps',       'SELECT'),
  ('task_steps',           'SELECT'),
  ('checklist_modules',    'SELECT'),
  ('checklist_items',      'SELECT'),
  ('task_media',           'SELECT'),
  ('problems',             'SELECT'),
  ('supply_requests',      'SELECT'),
  ('supply_request_items', 'SELECT'),
  ('supply_catalog_items',  'SELECT'),
  ('expired_tasks_review', 'SELECT'),
  ('report_properties',    'SELECT');

create temp table actual as
select grantee, table_name as relation,
       string_agg(privilege_type, ',' order by privilege_type) as privs
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated')
group by grantee, table_name;

-- ---------- every relation is accounted for ----------
select pg_temp.check('every relation in public has a row in the matrix',
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), '')
   from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relkind in ('r', 'p', 'v', 'm')
     and c.relname not in (select relation from wanted)),
  '');

select pg_temp.check('and the matrix names no relation that is gone',
  (select coalesce(string_agg(w.relation, ', ' order by w.relation), '')
   from wanted w
   where to_regclass('public.' || w.relation) is null),
  '');

-- ---------- authenticated: exactly the matrix ----------
select pg_temp.check('authenticated holds nothing beyond the matrix',
  (select coalesce(string_agg(a.relation || ' ' || a.privs, '; ' order by a.relation), '')
   from actual a
   left join wanted w on w.relation = a.relation
   where a.grantee = 'authenticated' and a.privs is distinct from w.privs),
  '');

select pg_temp.check('and nothing short of it',
  (select coalesce(string_agg(w.relation, ', ' order by w.relation), '')
   from wanted w
   left join actual a on a.relation = w.relation and a.grantee = 'authenticated'
   where a.privs is null),
  '');

select pg_temp.check('TRUNCATE is off every table',
  (select count(*)::int from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
     and has_table_privilege('authenticated', c.oid, 'TRUNCATE')),
  0);

select pg_temp.check('TRIGGER is off every table',
  (select count(*)::int from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
     and has_table_privilege('authenticated', c.oid, 'TRIGGER')),
  0);

-- ---------- anon: nothing at all ----------
select pg_temp.check('anon holds no table privilege',
  (select coalesce(string_agg(a.relation, ', ' order by a.relation), '')
   from actual a where a.grantee = 'anon'),
  '');

-- ---------- default privileges: the next table starts empty ----------
--
-- Migrations run as `postgres`, so it is the defaults of that role that decide
-- what a freshly created table carries. Read pg_default_acl directly: the
-- information_schema has no view of it.
select pg_temp.check('postgres hands new tables to neither client role',
  (select coalesce(string_agg(distinct g.grantee::regrole::text, ', '), '')
   from pg_default_acl d
   cross join lateral aclexplode(d.defaclacl) g
   where d.defaclrole = 'postgres'::regrole
     and d.defaclnamespace = 'public'::regnamespace
     and d.defaclobjtype = 'r'
     and g.grantee in ('anon'::regrole, 'authenticated'::regrole)),
  '');

-- ---------- raw: closed to clients as a whole ----------
--
-- raw holds what no client may read: the Hostaway payloads with guest names
-- and phones, and the generator's run trace (20260923120000). It is closed by
-- 20260824190000_helpers.sql and nothing else said so until now -- the matrix
-- above looks at public only.
--
-- The checks ask what a client role can actually DO, through the has_*
-- functions, rather than reading ACL arrays: those resolve PUBLIC, role
-- membership, column grants and built-in defaults (a new function is
-- executable by PUBLIC without any ACL entry saying so), where the arrays show
-- only what was written down. The schema is the first gate; the objects
-- behind it are checked too, so that opening the schema one day does not
-- expose whatever sits underneath. And raw has two doors that bypass the
-- schema gate altogether, both running with their owner's rights: a function
-- that reads raw, and a view built on it. Neither may be callable by a client.
select pg_temp.check('neither client role may enter schema raw',
  (select coalesce(string_agg(r || ' ' || p, ', ' order by r, p), '')
   from unnest(array['anon', 'authenticated']) r
   cross join unnest(array['USAGE', 'CREATE']) p
   where has_schema_privilege(r, 'raw', p)),
  '');

select pg_temp.check('no object in raw is usable by a client role, schema aside',
  (select coalesce(string_agg(x, ', ' order by x), '')
   from (
     select r || ' ' || c.relname as x
     from pg_class c cross join unnest(array['anon', 'authenticated']) r
     where c.relnamespace = 'raw'::regnamespace
       and c.relkind in ('r', 'p', 'v', 'm', 'f')
       and (has_table_privilege(r, c.oid,
              'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            or has_any_column_privilege(r, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES'))
     union all
     select r || ' ' || c.relname
     from pg_class c cross join unnest(array['anon', 'authenticated']) r
     where c.relnamespace = 'raw'::regnamespace and c.relkind = 'S'
       and has_sequence_privilege(r, c.oid, 'USAGE,SELECT,UPDATE')
     union all
     select r || ' ' || p.oid::regprocedure::text
     from pg_proc p cross join unnest(array['anon', 'authenticated']) r
     where p.pronamespace = 'raw'::regnamespace
       and has_function_privilege(r, p.oid, 'EXECUTE')
   ) leaks),
  '');

select pg_temp.check('no function that touches raw is callable by a client role',
  (select coalesce(string_agg(p.oid::regprocedure::text, ', ' order by 1), '')
   from pg_proc p
   where p.pronamespace not in ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
     and p.prosrc ~ '\mraw\.'
     and (has_function_privilege('anon', p.oid, 'EXECUTE')
          or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  '');

select pg_temp.check('no view built on raw is readable by a client role',
  (select coalesce(string_agg(distinct v.oid::regclass::text, ', '), '')
   from pg_rewrite rw
   join pg_class v on v.oid = rw.ev_class
   join pg_depend d on d.classid = 'pg_rewrite'::regclass and d.objid = rw.oid
   join pg_class t on t.oid = d.refobjid
   where t.relnamespace = 'raw'::regnamespace
     and v.oid <> t.oid
     and (has_table_privilege('anon', v.oid, 'SELECT')
          or has_table_privilege('authenticated', v.oid, 'SELECT'))),
  '');

select pg_temp.check('no default privilege hands a new raw object to a client role',
  (select coalesce(string_agg(distinct d.defaclrole::regrole::text || ' ' || d.defaclobjtype::text, ', '), '')
   from pg_default_acl d
   cross join lateral aclexplode(d.defaclacl) g
   where d.defaclnamespace in (0, 'raw'::regnamespace)
     and g.grantee in (0, 'anon'::regrole, 'authenticated'::regrole)),
  '');

rollback;
