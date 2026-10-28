-- Public API v1 (docs/api-v1.md, 20261028100000). Run: npm run test:rls
-- Before the migration is on the stand: node scripts/api-stand.mjs check
-- (the migration and this suite in one transaction, rolled back).
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected:
--   * keys are kept as a digest only, and a key works while its maker is an
--     active admin of the company, unrevoked and unexpired;
--   * presets are computed from the registry at every call: a new ordinary
--     read scope joins "read only", any new scope joins "full", a sensitive one
--     never joins "read only", a planned or forbidden one joins nothing;
--   * no key holds a forbidden scope, whatever the preset;
--   * a key sees its own company only, and within it only its properties and
--     their rooms; the company never comes from the request;
--   * a write goes through the panel's function as the key's maker, so a task
--     always has an author and the journals name him;
--   * an idempotency key replays the first answer, refuses another body, and
--     forgets a failure;
--   * a change of scopes takes effect at once and is journalled;
--   * no answer carries a guest's name or price, a staff e-mail or phone, a door
--     code from a property's name, or a free-text note.
--
-- Fixture ids live in the 9002810xx range and under a28….
begin;

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $$;

create or replace function pg_temp.raises(label text, stmt text, want_hint text)
returns void language plpgsql as $$
declare
  v_hint  text;
  v_state text;
begin
  begin
    execute stmt;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint, v_state = returned_sqlstate;
    if nullif(v_hint, '') is distinct from want_hint then
      raise exception 'FAIL % — hint %, want % (%)', label, v_hint, want_hint, v_state;
    end if;
    raise notice 'ok  %', label;
    return;
  end;
  raise exception 'FAIL % — no error, want %', label, want_hint;
end $$;

-- The digest the Edge Function would send for a key: here a plain sha256 of a
-- name stands in for HMAC(pepper, key) — the database never sees the pepper.
create or replace function pg_temp.d(t text) returns text language sql as $$
  select encode(sha256(convert_to(t, 'UTF8')), 'hex')
$$;

create or replace function pg_temp.as_user(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
                    json_build_object('sub', p_id, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p_id::text, true);
$$;

create or replace function pg_temp.as_server() returns void language sql as $$
  select set_config('request.jwt.claims', '', true),
         set_config('request.jwt.claim.sub', '', true),
         set_config('request.jwt.claim.role', '', true);
$$;

-- ---------- fixtures ----------

insert into public.hosts (id, name) values
  ('a2800000-0000-4000-8000-00000000000a', 'Host A'),
  ('a2800000-0000-4000-8000-00000000000b', 'Host B');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('a2800001-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','ada.api@test.local','x',now(),now(),
   '{"full_name":"Ada Admin"}'::jsonb, '{"role":"admin"}'::jsonb),
  ('a2800002-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','alan.api@test.local','x',now(),now(),
   '{"full_name":"Alan Admin"}'::jsonb, '{"role":"admin"}'::jsonb),
  ('a2800003-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','mia.api@test.local','x',now(),now(),
   '{"full_name":"Mia Manager"}'::jsonb, '{"role":"manager"}'::jsonb),
  ('a2800004-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','tom.api@test.local','x',now(),now(),
   '{"full_name":"Tom Tech"}'::jsonb, '{"role":"tech"}'::jsonb),
  ('a2800005-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000005',
   'authenticated','authenticated','cleo.api@test.local','x',now(),now(),
   '{"full_name":"Cleo Cleaner"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('a2800006-0000-4000-8000-000000000006','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','bob.api@test.local','x',now(),now(),
   '{"full_name":"Bob Admin"}'::jsonb, '{"role":"admin"}'::jsonb);

update public.profiles set host_id = 'a2800000-0000-4000-8000-00000000000a', phone = '+420700000000'
where id::text like 'a280000_-0000-4000-8000-00000000000_' and id <> 'a2800006-0000-4000-8000-000000000006';
update public.profiles set host_id = 'a2800000-0000-4000-8000-00000000000b'
where id = 'a2800006-0000-4000-8000-000000000006';

insert into public.properties (id, host_id, name, timezone, address) values
  (900281001, 'a2800000-0000-4000-8000-00000000000a', 'Main House |code - 1234| 4G', 'Europe/Prague', 'Street 1'),
  (900281003, 'a2800000-0000-4000-8000-00000000000a', 'Flat Two', 'Europe/Prague', 'Street 2'),
  (900281901, 'a2800000-0000-4000-8000-00000000000b', 'Other Co Flat', 'Europe/Prague', 'Street 9');
insert into public.properties (id, host_id, name, timezone, parent_id) values
  (900281002, 'a2800000-0000-4000-8000-00000000000a', 'Unit 3 - 5678', 'Europe/Prague', 900281001),
  (900281004, 'a2800000-0000-4000-8000-00000000000a', 'Unit 4 - keypad 1234 2BR', 'Europe/Prague', 900281001);

insert into public.tasks (id, host_id, property_id, type, status, scheduled_date, notes) values
  ('a2810000-0000-4000-8000-000000000001', 'a2800000-0000-4000-8000-00000000000a', 900281003,
   'cleaning', 'unassigned', '2026-11-02', 'door code 9999'),
  ('a2810000-0000-4000-8000-000000000002', 'a2800000-0000-4000-8000-00000000000a', 900281002,
   'cleaning', 'unassigned', '2026-11-03', null),
  ('a2810000-0000-4000-8000-000000000003', 'a2800000-0000-4000-8000-00000000000a', 900281003,
   'inspection', 'unassigned', '2026-11-02', null),
  ('a2810000-0000-4000-8000-000000000009', 'a2800000-0000-4000-8000-00000000000b', 900281901,
   'cleaning', 'unassigned', '2026-11-02', null);

insert into public.problems (id, host_id, property_id, reported_by, title, description) values
  ('a2820000-0000-4000-8000-000000000001', 'a2800000-0000-4000-8000-00000000000a', 900281003,
   'a2800005-0000-4000-8000-000000000005', 'Leaking tap', 'Kitchen'),
  ('a2820000-0000-4000-8000-000000000002', 'a2800000-0000-4000-8000-00000000000a', null,
   'a2800003-0000-4000-8000-000000000003', 'Office thing', null),
  ('a2820000-0000-4000-8000-000000000003', 'a2800000-0000-4000-8000-00000000000a', 900281003,
   'a2800005-0000-4000-8000-000000000005', 'Lockbox code 4821 broken', 'the lockbox code 4821 does not open, try door 7731'),
  ('a2820000-0000-4000-8000-000000000009', 'a2800000-0000-4000-8000-00000000000b', 900281901,
   'a2800006-0000-4000-8000-000000000006', 'B problem', null);

insert into public.reservations (id, host_id, property_id, arrival_date, departure_date, status,
                                 channel_id, guest_name, guests_count, total_price, is_block) values
  (900281501, 'a2800000-0000-4000-8000-00000000000a', 900281001, '2026-11-01', '2026-11-04', 'new',
   2018, 'Guest Secret', 2, 999, false),
  (900281502, 'a2800000-0000-4000-8000-00000000000a', 900281003, '2026-11-10', '2026-11-12', 'new',
   2005, 'Another Guest', 1, 500, false),
  (900281591, 'a2800000-0000-4000-8000-00000000000b', 900281901, '2026-11-01', '2026-11-03', 'new',
   2018, 'B Guest', 2, 100, false);
insert into public.reservation_units (host_id, reservation_id, property_id) values
  ('a2800000-0000-4000-8000-00000000000a', 900281501, 900281002),
  ('a2800000-0000-4000-8000-00000000000a', 900281501, 900281004);

insert into public.task_steps (id, task_id, host_id, sort_order, type, required) values
  ('a2830000-0000-4000-8000-000000000001', 'a2810000-0000-4000-8000-000000000001',
   'a2800000-0000-4000-8000-00000000000a', 1, 'photos_before', false);
insert into public.task_media (id, host_id, kind, storage_path, mime_type, byte_size,
                               task_id, step_id, uploaded_at) values
  ('a2840000-0000-4000-8000-000000000001', 'a2800000-0000-4000-8000-00000000000a', 'photo',
   'a2800000-0000-4000-8000-00000000000a/a2840000-0000-4000-8000-000000000001.jpg', 'image/jpeg', 1000,
   'a2810000-0000-4000-8000-000000000001', 'a2830000-0000-4000-8000-000000000001', now());
insert into public.task_media (id, host_id, kind, storage_path, mime_type, byte_size, duration_sec,
                               problem_id) values
  ('a2840000-0000-4000-8000-000000000002', 'a2800000-0000-4000-8000-00000000000a', 'video',
   'a2800000-0000-4000-8000-00000000000a/a2840000-0000-4000-8000-000000000002.mp4', 'video/mp4', 5000, 10,
   'a2820000-0000-4000-8000-000000000001');

-- ---------- 1. making keys ----------

select (public.create_api_key('a2800001-0000-4000-8000-000000000001', 'Full key', 'woom_fullAAA',
          pg_temp.d('key-full'), 'full', '{}', null, null, 'Full key')) ->> 'id' as k_full \gset
select (public.create_api_key('a2800001-0000-4000-8000-000000000001', 'Read key', 'woom_readAAA',
          pg_temp.d('key-read'), 'read_only')) ->> 'id' as k_read \gset
select (public.create_api_key('a2800001-0000-4000-8000-000000000001', 'Operator key', 'woom_operAAA',
          pg_temp.d('key-oper'), 'operator')) ->> 'id' as k_oper \gset
select (public.create_api_key('a2800001-0000-4000-8000-000000000001', 'Custom key', 'woom_custAAA',
          pg_temp.d('key-cust'), 'custom', '{cleanings:read}')) ->> 'id' as k_cust \gset
select (public.create_api_key('a2800002-0000-4000-8000-000000000002', 'House key', 'woom_housAAA',
          pg_temp.d('key-house'), 'operator', '{}', '{900281001}')) ->> 'id' as k_house \gset
select (public.create_api_key('a2800001-0000-4000-8000-000000000001', 'Sensitive key', 'woom_sensAAA',
          pg_temp.d('key-sens'), 'read_only', '{staff:read_names,properties:read_address}',
          null, now() + interval '30 days')) ->> 'id' as k_sens \gset
select (public.create_api_key('a2800001-0000-4000-8000-000000000001', 'Create-only key', 'woom_tcreAAA',
          pg_temp.d('key-tc'), 'custom', '{tasks:create}')) ->> 'id' as k_tc \gset
select (public.create_api_key('a2800001-0000-4000-8000-000000000001', 'Room key', 'woom_roomAAA',
          pg_temp.d('key-room'), 'read_only', '{}', '{900281002}')) ->> 'id' as k_room \gset
select (public.create_api_key('a2800006-0000-4000-8000-000000000006', 'B key', 'woom_bbbbAAA',
          pg_temp.d('key-b'), 'full', '{}', null, null, 'B key')) ->> 'id' as k_b \gset

select pg_temp.check('a key is kept as its digest, never as the key',
  (select count(*)::int from public.api_keys k
   where k.id = :'k_full'::uuid and k.key_digest = pg_temp.d('key-full')
     and to_jsonb(k)::text not like '%key-full%'),
  1);

select pg_temp.check('no column of api_keys could hold a raw key',
  (select string_agg(column_name, ',' order by column_name) from information_schema.columns
   where table_schema = 'public' and table_name = 'api_keys'),
  'created_at,created_by,expires_at,host_id,id,key_digest,last_used_at,name,prefix,preset,property_ids,revoked_at,revoked_by,scopes,updated_at');

select pg_temp.raises('a digest that is not a hex sha256 is refused',
  $$select public.create_api_key('a2800001-0000-4000-8000-000000000001', 'Bad', 'woom_badAAAA',
      'woom_plain_key_value', 'read_only')$$,
  null);

select pg_temp.raises('a manager may not make a key',
  $$select public.create_api_key('a2800003-0000-4000-8000-000000000003', 'M', 'woom_mgrAAAA',
      pg_temp.d('key-m'), 'read_only')$$,
  'serverErrors.adminOnly');

select pg_temp.raises('a forbidden scope is never granted, even beside full access',
  $$select public.create_api_key('a2800001-0000-4000-8000-000000000001', 'F', 'woom_forbAAA',
      pg_temp.d('key-f'), 'full', '{api_keys:manage}', null, null, 'F')$$,
  'serverErrors.apiScopeForbidden');

select pg_temp.raises('every forbidden scope is refused in a custom set',
  $$select public.create_api_key('a2800001-0000-4000-8000-000000000001', 'F', 'woom_forbBBB',
      pg_temp.d('key-f2'), 'custom', '{access_codes:read}')$$,
  'serverErrors.apiScopeForbidden');

select pg_temp.raises('a planned scope cannot be granted yet',
  $$select public.create_api_key('a2800001-0000-4000-8000-000000000001', 'P', 'woom_planAAA',
      pg_temp.d('key-p'), 'custom', '{webhooks:manage}')$$,
  'serverErrors.apiScopeNotYetAvailable');

select pg_temp.raises('an unknown scope is refused',
  $$select public.create_api_key('a2800001-0000-4000-8000-000000000001', 'U', 'woom_unknAAA',
      pg_temp.d('key-u'), 'custom', '{everything:all}')$$,
  'serverErrors.apiScopeUnknown');

select pg_temp.raises('full access needs the name typed again',
  $$select public.create_api_key('a2800001-0000-4000-8000-000000000001', 'Careless', 'woom_carelAA',
      pg_temp.d('key-c'), 'full')$$,
  'serverErrors.apiFullAccessUnconfirmed');

select pg_temp.raises('a property of another company cannot restrict a key',
  $$select public.create_api_key('a2800001-0000-4000-8000-000000000001', 'X', 'woom_xcoAAAA',
      pg_temp.d('key-x'), 'read_only', '{}', '{900281901}')$$,
  'serverErrors.propertyNotFound');

select pg_temp.raises('a key lives a year at most',
  $$select public.create_api_key('a2800001-0000-4000-8000-000000000001', 'Y', 'woom_yearAAA',
      pg_temp.d('key-y'), 'read_only', '{}', null, now() + interval '400 days')$$,
  'serverErrors.apiExpiryInvalid');

select pg_temp.check('making a key is journalled with what it was made with',
  (select e.after ->> 'preset' from public.api_key_events e
   where e.key_id = :'k_oper'::uuid and e.kind = 'created'
     and e.actor_id = 'a2800001-0000-4000-8000-000000000001'),
  'operator');

-- ---------- 2. presets, now and later ----------

select pg_temp.check('read only: every ordinary read scope',
  (select array_to_string(public.api_effective_scopes('read_only', '{}'), ',')),
  'bookings:read,cleanings:read,media:read,properties:read,settings:read,staff:read,tasks:read');

select pg_temp.check('operator: reading, and creating and assigning tasks and cleanings',
  (select array_to_string(public.api_effective_scopes('operator', '{}'), ',')),
  'bookings:read,cleanings:assign,cleanings:read,media:read,properties:read,settings:read,staff:read,tasks:assign,tasks:create,tasks:read');

select pg_temp.check('full: every exposed scope, the sensitive ones included',
  (select array_to_string(public.api_effective_scopes('full', '{}'), ',')),
  (select string_agg(id, ',' order by id) from public.api_scopes where status = 'exposed'));

select pg_temp.check('custom: exactly what was ticked',
  (select array_to_string(public.api_effective_scopes('custom', '{cleanings:read}'), ',')),
  'cleanings:read');

select pg_temp.check('a sensitive scope added by hand joins read only',
  (select 'staff:read_names' = any(public.api_effective_scopes('read_only', '{staff:read_names}'))),
  true);

select pg_temp.check('no preset ever yields a forbidden or a planned scope',
  (select count(*)::int from public.api_scopes s
   where s.status <> 'exposed'
     and (s.id = any(public.api_effective_scopes('full', '{}'))
          or s.id = any(public.api_effective_scopes('operator', array[s.id]))
          or s.id = any(public.api_effective_scopes('custom', array[s.id])))),
  0);

-- Scopes that appear after the keys were made.
insert into public.api_scopes (id, scope_group, action, sensitivity, status, operator) values
  ('zz_test:read', 'zz', 'read', 'normal', 'exposed', false),
  ('zz_test:read_secret', 'zz', 'read', 'sensitive', 'exposed', false),
  ('zz_test:write', 'zz', 'write', 'normal', 'exposed', true),
  ('zz_test:later', 'zz', 'read', 'normal', 'planned', false);

select pg_temp.check('a new ordinary read scope joins read only by itself',
  (select 'zz_test:read' = any(public.api_effective_scopes('read_only', '{}'))), true);
select pg_temp.check('a new sensitive scope does not join read only',
  (select 'zz_test:read_secret' = any(public.api_effective_scopes('read_only', '{}'))), false);
select pg_temp.check('a new operator write joins operator',
  (select 'zz_test:write' = any(public.api_effective_scopes('operator', '{}'))), true);
select pg_temp.check('every new exposed scope joins full access',
  (select array['zz_test:read', 'zz_test:read_secret', 'zz_test:write']
          <@ public.api_effective_scopes('full', '{}')), true);
select pg_temp.check('a new planned scope joins nothing',
  (select 'zz_test:later' = any(public.api_effective_scopes('full', '{}'))), false);
select pg_temp.check('an existing full key holds the new scopes at once',
  (select (public.api_v1_get_me(pg_temp.d('key-full')) -> 'key' -> 'scopes') ? 'zz_test:read_secret'),
  true);

delete from public.api_scopes where id like 'zz\_test:%';

-- ---------- 3. the gate ----------

select pg_temp.check('the gate lets a good key in, with its window',
  (select g ->> 'ok' || ' ' || (g ->> 'limit') || ' ' || (g ->> 'remaining')
   from public.api_gate(pg_temp.d('key-read'), pg_temp.d('ip-1')) g),
  'true 120 119');

select pg_temp.check('the gate gives the digest back for the constant-time compare',
  (select g ->> 'digest' from public.api_gate(pg_temp.d('key-read'), pg_temp.d('ip-1')) g),
  pg_temp.d('key-read'));

select pg_temp.check('no key: missing-key',
  (select g ->> 'code' from public.api_gate(null, pg_temp.d('ip-1')) g), 'missing-key');
select pg_temp.check('an unknown key: invalid-key',
  (select g ->> 'code' from public.api_gate(pg_temp.d('nope'), pg_temp.d('ip-1')) g), 'invalid-key');

select pg_temp.check('failed attempts count against the IP',
  (select w.hits from public.api_rate_windows w
   where w.bucket = 'ip:' || pg_temp.d('ip-1')), 2);

select public.api_gate(pg_temp.d('nope-' || n), pg_temp.d('ip-2')) from generate_series(1, 20) n;
select pg_temp.check('the twenty-first failure in ten minutes is turned away',
  (select g ->> 'code' from public.api_gate(pg_temp.d('nope-21'), pg_temp.d('ip-2')) g),
  'rate-limited');
select pg_temp.check('but a good key from the same address is never held up by it',
  (select g ->> 'ok' from public.api_gate(pg_temp.d('key-read'), pg_temp.d('ip-2')) g), 'true');
select pg_temp.check('other IPs stay open',
  (select g ->> 'ok' from public.api_gate(pg_temp.d('key-read'), pg_temp.d('ip-3')) g), 'true');

update public.api_rate_windows set hits = 120
where bucket = 'key:' || :'k_read' and window_start = date_trunc('minute', now());
select pg_temp.check('120 requests a minute per key, then rate-limited with a reset',
  (select (g ->> 'code') || ' ' || ((g ->> 'retry_after')::int between 1 and 60)::text
   from public.api_gate(pg_temp.d('key-read'), pg_temp.d('ip-3')) g),
  'rate-limited true');
delete from public.api_rate_windows where bucket = 'key:' || :'k_read';

select pg_temp.check('the gate marks the key as used',
  (select last_used_at is not null from public.api_keys where id = :'k_read'::uuid), true);

-- ---------- 4. scopes per operation ----------

select pg_temp.raises('read only cannot create a task: insufficient-scope',
  format($$select public.api_v1_create_task(%L, 'i-1', %L, 'T')$$,
         pg_temp.d('key-read'), pg_temp.d('body-1')),
  'api:insufficient-scope');

do $$
declare v_detail text;
begin
  perform public.api_v1_list_properties(pg_temp.d('key-cust'));
  raise exception 'FAIL custom key read properties';
exception when insufficient_privilege then
  get stacked diagnostics v_detail = pg_exception_detail;
  if (v_detail::jsonb ->> 'required_scope') is distinct from 'properties:read' then
    raise exception 'FAIL the refusal names the scope — got %', v_detail;
  end if;
  raise notice 'ok  a refusal names the scope it needed';
end $$;

select pg_temp.check('the custom key does what it was given',
  (select jsonb_typeof(public.api_v1_list_cleanings(pg_temp.d('key-cust')))), 'array');

select pg_temp.raises('creating with an assignee needs tasks:assign as well',
  format($$select public.api_v1_create_task(%L, 'i-2', %L, 'T', null, null, 900281003,
           'a2800004-0000-4000-8000-000000000004')$$,
         pg_temp.d('key-tc'), pg_temp.d('body-2')),
  'api:insufficient-scope');

-- ---------- 5. one company, its properties ----------

select pg_temp.check('a key lists its own company''s properties only',
  (select string_agg(p ->> 'id', ',' order by (p ->> 'id')::bigint)
   from jsonb_array_elements(public.api_v1_list_properties(pg_temp.d('key-full'))) p
   where (p ->> 'id')::bigint between 900281000 and 900281999),
  '900281001,900281002,900281003,900281004');

select pg_temp.raises('another company''s property is not found',
  format('select public.api_v1_get_property(%L, 900281901)', pg_temp.d('key-full')), 'api:not-found');
select pg_temp.raises('another company''s cleaning is not found',
  format($$select public.api_v1_get_cleaning(%L, 'a2810000-0000-4000-8000-000000000009')$$,
         pg_temp.d('key-full')), 'api:not-found');
select pg_temp.raises('another company''s task is not found',
  format($$select public.api_v1_get_task(%L, 'a2820000-0000-4000-8000-000000000009')$$,
         pg_temp.d('key-full')), 'api:not-found');
select pg_temp.raises('another company''s booking is not found',
  format('select public.api_v1_get_booking(%L, 900281591)', pg_temp.d('key-full')), 'api:not-found');
select pg_temp.raises('another company''s person is not found',
  format($$select public.api_v1_get_staff_member(%L, 'a2800006-0000-4000-8000-000000000006')$$,
         pg_temp.d('key-full')), 'api:not-found');

select pg_temp.check('lists hold no row of another company',
  (select count(*)::int from (
     select c ->> 'property_id' as p from jsonb_array_elements(
       public.api_v1_list_cleanings(pg_temp.d('key-full'), p_limit => 200)) c
     union all
     select b ->> 'property_id' from jsonb_array_elements(
       public.api_v1_list_bookings(pg_temp.d('key-full'), p_limit => 200)) b
     union all
     select t ->> 'property_id' from jsonb_array_elements(
       public.api_v1_list_tasks(pg_temp.d('key-full'), p_limit => 200)) t) x
   where x.p = '900281901'),
  0);

select pg_temp.check('settings are the key''s company''s',
  (select public.api_v1_get_settings(pg_temp.d('key-b')) ->> 'company_name'), 'Host B');

select pg_temp.check('the house key sees the house and its room, not the flat',
  (select string_agg(p ->> 'id', ',' order by (p ->> 'id')::bigint)
   from jsonb_array_elements(public.api_v1_list_properties(pg_temp.d('key-house'))) p),
  '900281001,900281002,900281004');
select pg_temp.check('the house key sees the room''s cleaning, not the flat''s',
  (select string_agg(c ->> 'id', ',')
   from jsonb_array_elements(public.api_v1_list_cleanings(pg_temp.d('key-house'), p_limit => 200)) c
   where c ->> 'id' like 'a2810000-%'),
  'a2810000-0000-4000-8000-000000000002');
select pg_temp.raises('the flat''s cleaning is not found for the house key',
  format($$select public.api_v1_get_cleaning(%L, 'a2810000-0000-4000-8000-000000000001')$$,
         pg_temp.d('key-house')), 'api:not-found');
select pg_temp.check('the house key does not see a task of no property',
  (select count(*)::int from jsonb_array_elements(public.api_v1_list_tasks(pg_temp.d('key-house'))) t
   where t ->> 'id' = 'a2820000-0000-4000-8000-000000000002'),
  0);
select pg_temp.check('the house key sees the booking that took its room',
  (select count(*)::int
   from jsonb_array_elements(public.api_v1_list_bookings(pg_temp.d('key-house'), p_limit => 200)) b
   where b ->> 'id' in ('900281501', '900281502')),
  1);
select pg_temp.raises('the house key may not write on the flat',
  format($$select public.api_v1_create_task(%L, 'h-1', %L, 'Broken lamp', null, null, 900281003)$$,
         pg_temp.d('key-house'), pg_temp.d('body-h1')),
  'api:property-not-allowed');
select pg_temp.raises('nor write a task of no property',
  format($$select public.api_v1_create_task(%L, 'h-2', %L, 'Broken lamp')$$,
         pg_temp.d('key-house'), pg_temp.d('body-h2')),
  'api:property-not-allowed');

-- ---------- 6. what answers never carry ----------

select pg_temp.check('a code in a property''s name is masked, and said so',
  (select (p ->> 'name') || ' / ' || (p ->> 'name_masked')
   from public.api_v1_get_property(pg_temp.d('key-full'), 900281001) p),
  'Main House 4G / true');
select pg_temp.check('a room named by its code is masked too',
  (select p ->> 'name' from public.api_v1_get_property(pg_temp.d('key-full'), 900281002) p),
  'Unit 3 - ••••');
select pg_temp.check('a plain name is left exactly as it is',
  (select (p ->> 'name') || ' / ' || (p ->> 'name_masked')
   from public.api_v1_get_property(pg_temp.d('key-full'), 900281003) p),
  'Flat Two / false');

-- The shapes of the cloud's names that hold a code (28.10, every digit read
-- as #), with 7 for each digit: none keeps a code.
select pg_temp.check('every shape of a coded name in the cloud comes out without a code',
  (select count(*)::int
   from (values ('7 - 7777'), ('Blazenka 7 floor - Casino |code - 7777| 7G 7BR 7B'),
                ('Blazenka 7 floor - Miami |code - 7777| 7G 7BR 7.7B'),
                ('Blazenka 7 floor |code - 7777| 7G 7BR 7.7B'),
                ('Blazenka 7 floor Rooftop |code - 7777| 7G 7BR 7B'),
                ('Blazenka unique villa 77 PERS |door - 777777| 77+G 77BR 7B'),
                ('DE - Koblenz 7 floor - |code 7777| 7G 7BR 7B'),
                ('DE - Koblenz 7 floor |code 7777| 7G 7BR 7B'),
                ('Ostricova -  villa |code - 7777|- 77G 7BR 7B'),
                ('Tiny house Big NEW |door 7777|'), ('Tiny house Small NEW - 7G |door 7777|'),
                ('Tiny Viktor - Lake House |code - 7777| 7G 7BR 7B'),
                ('Unit 7 - 7 floor - keypad 7777777'), ('Unit 7 - 7777'), ('Unit 7 - 7777777'),
                ('Unit 7 - 7rd floor - lockbox 7777'), ('Unit 7 - 7st floor - keypad 7777777'),
                ('Unit 77 - 7rd floor - lockbox 7777')) v(name)
   where public.api_safe_property_name(name) ~ '[0-9]{4,}'
      or public.api_safe_property_name(name) ~* '(code|door|lock ?box|keypad)\s*[-:]?\s*[0-9]'
      or public.api_safe_property_name(name) = name),
  0);

select pg_temp.check('the address only with properties:read_address',
  (select (public.api_v1_get_property(pg_temp.d('key-full'), 900281003) ? 'address')::text || ' '
       || (public.api_v1_get_property(pg_temp.d('key-read'), 900281003) ? 'address')::text || ' '
       || (public.api_v1_get_property(pg_temp.d('key-sens'), 900281003) ->> 'address')),
  'true false Street 2');

select pg_temp.check('a name of staff only with staff:read_names',
  (select (public.api_v1_get_staff_member(pg_temp.d('key-read'), 'a2800005-0000-4000-8000-000000000005') ? 'full_name')::text
       || ' ' || (public.api_v1_get_staff_member(pg_temp.d('key-sens'), 'a2800005-0000-4000-8000-000000000005') ->> 'full_name')),
  'false Cleo Cleaner');

select pg_temp.check('no staff e-mail or phone, at any scope',
  (select count(*)::int from jsonb_array_elements(public.api_v1_list_staff(pg_temp.d('key-full'), p_limit => 200)) s
   where s ? 'email' or s ? 'phone' or s::text like '%@test.local%' or s::text like '%+420%'),
  0);

select pg_temp.check('no guest name and no price in a booking',
  (select count(*)::int from jsonb_array_elements(public.api_v1_list_bookings(pg_temp.d('key-full'), p_limit => 200)) b
   where b ? 'guest_name' or b ? 'total_price' or b::text like '%Guest%' or b::text like '%999%'),
  0);

select pg_temp.check('a booking names its channel and the rooms it took',
  (select (b ->> 'channel') || ' ' || (b -> 'room_ids')::text
   from public.api_v1_get_booking(pg_temp.d('key-full'), 900281501) b),
  'airbnb [900281002, 900281004]');

select pg_temp.check('no free-text note of a cleaning',
  (select (c ? 'notes')::text || ' ' || (c::text like '%9999%')::text
   from public.api_v1_get_cleaning(pg_temp.d('key-full'), 'a2810000-0000-4000-8000-000000000001') c),
  'false false');

select pg_temp.check('media: metadata of the cleaning''s photo, no path',
  (select (m ->> 'kind') || ' ' || (m ->> 'step_type') || ' ' || (m ->> 'status') || ' '
       || (m ? 'storage_path')::text
   from jsonb_array_elements(public.api_v1_list_cleaning_media(pg_temp.d('key-read'),
          'a2810000-0000-4000-8000-000000000001')) m),
  'photo photos_before uploaded false');
select pg_temp.check('media: the task''s video',
  (select (m ->> 'kind') || ' ' || ((m ->> 'duration_sec')::numeric = 10)::text
   from jsonb_array_elements(public.api_v1_list_task_media(pg_temp.d('key-read'),
          'a2820000-0000-4000-8000-000000000001')) m),
  'video true');

select pg_temp.check('timestamps are UTC with Z, days are plain dates',
  (select (c ->> 'created_at') ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$'
          and (c ->> 'scheduled_date') = '2026-11-02'
   from public.api_v1_get_cleaning(pg_temp.d('key-full'), 'a2810000-0000-4000-8000-000000000001') c),
  true);

-- ---------- 7. pages ----------

select pg_temp.check('a page holds one more than the limit, to tell there is more',
  (select jsonb_array_length(public.api_v1_list_properties(pg_temp.d('key-house'), p_limit => 1))),
  2);
select pg_temp.check('the next page starts after the last id',
  (select p -> 0 ->> 'id' from public.api_v1_list_properties(pg_temp.d('key-house'),
           p_after_id => 900281001, p_limit => 1) p),
  '900281002');

-- ---------- 8. writes as the key's maker ----------

select public.api_v1_create_task(pg_temp.d('key-oper'), 'idem-1', pg_temp.d('body-create-1'),
         'Broken window', 'Bedroom', 'high', 900281003) as created_1 \gset

select pg_temp.check('a task made through the API is answered 201, not replayed',
  (select (:'created_1'::jsonb ->> 'status') || ' ' || (:'created_1'::jsonb ->> 'replayed')),
  '201 false');
select pg_temp.check('its author is the key''s maker, never nobody',
  (select reported_by::text from public.problems
   where id = (:'created_1'::jsonb -> 'body' ->> 'id')::uuid),
  'a2800001-0000-4000-8000-000000000001');
select pg_temp.check('the task''s journal names the maker',
  (select actor_id::text from public.problem_events
   where problem_id = (:'created_1'::jsonb -> 'body' ->> 'id')::uuid and kind = 'reported'),
  'a2800001-0000-4000-8000-000000000001');

select pg_temp.as_server();
select pg_temp.check('the same idempotency key and body replay the first answer',
  (select (r ->> 'replayed') || ' ' || (r -> 'body' ->> 'id' = :'created_1'::jsonb -> 'body' ->> 'id')::text
   from public.api_v1_create_task(pg_temp.d('key-oper'), 'idem-1', pg_temp.d('body-create-1'),
          'Broken window', 'Bedroom', 'high', 900281003) r),
  'true true');
select pg_temp.check('and make no second task',
  (select count(*)::int from public.problems where title = 'Broken window'), 1);
select pg_temp.raises('the same idempotency key with another body is refused',
  format($$select public.api_v1_create_task(%L, 'idem-1', %L, 'Broken door')$$,
         pg_temp.d('key-oper'), pg_temp.d('body-create-2')),
  'api:idempotency-key-reused');
select pg_temp.raises('a POST without an idempotency key is refused',
  format($$select public.api_v1_create_task(%L, null, %L, 'Broken door')$$,
         pg_temp.d('key-oper'), pg_temp.d('body-create-3')),
  'api:idempotency-key-required');

select pg_temp.raises('a failure is not remembered: an empty title fails…',
  format($$select public.api_v1_create_task(%L, 'idem-2', %L, '   ')$$,
         pg_temp.d('key-oper'), pg_temp.d('body-create-4')),
  'serverErrors.problemTitleRequired');
select pg_temp.as_server();
select pg_temp.check('…and the same idempotency key then works with the fixed body',
  (select r ->> 'status' from public.api_v1_create_task(pg_temp.d('key-oper'), 'idem-2',
          pg_temp.d('body-create-5'), 'Fixed title') r),
  '201');

select pg_temp.as_server();
select public.api_v1_create_task(pg_temp.d('key-oper'), 'idem-3', pg_temp.d('body-create-6'),
         'Fix the boiler', null, null, 900281003, 'a2800004-0000-4000-8000-000000000004',
         '2026-11-05', '09:00', '11:00') as created_2 \gset
select pg_temp.check('created and handed to the technician in one call',
  (select (:'created_2'::jsonb -> 'body' -> 'work' ->> 'assignee_id') || ' '
       || (:'created_2'::jsonb -> 'body' -> 'work' ->> 'scheduled_date') || ' '
       || (:'created_2'::jsonb -> 'body' -> 'work' ->> 'time_from')),
  'a2800004-0000-4000-8000-000000000004 2026-11-05 09:00');

select pg_temp.as_server();
select pg_temp.check('assigning a task goes through assign_problem',
  (select r -> 'body' -> 'work' ->> 'assignee_id'
   from public.api_v1_assign_task(pg_temp.d('key-oper'), 'idem-4', pg_temp.d('body-assign-1'),
          'a2820000-0000-4000-8000-000000000001', 'a2800004-0000-4000-8000-000000000004') r),
  'a2800004-0000-4000-8000-000000000004');

select pg_temp.as_server();
select pg_temp.check('assigning a cleaning goes through save_task and changes only the executor',
  (select (r -> 'body' ->> 'assignee_id') || ' ' || (r -> 'body' ->> 'status') || ' '
       || (r -> 'body' ->> 'scheduled_date')
   from public.api_v1_assign_cleaning(pg_temp.d('key-oper'), 'idem-5', pg_temp.d('body-assign-2'),
          'a2810000-0000-4000-8000-000000000001', 'a2800005-0000-4000-8000-000000000005') r),
  'a2800005-0000-4000-8000-000000000005 assigned 2026-11-02');
select pg_temp.check('the cleaning keeps its note',
  (select notes from public.tasks where id = 'a2810000-0000-4000-8000-000000000001'),
  'door code 9999');
select pg_temp.check('the cleaning''s journal names the key''s maker',
  (select actor_id::text from public.task_events
   where task_id = 'a2810000-0000-4000-8000-000000000001' and kind = 'assigned'
   order by id desc limit 1),
  'a2800001-0000-4000-8000-000000000001');

select pg_temp.as_server();
select pg_temp.raises('a cleaning is not handed to a technician: the panel''s rule holds',
  format($$select public.api_v1_assign_cleaning(%L, 'idem-6', %L,
           'a2810000-0000-4000-8000-000000000002', 'a2800004-0000-4000-8000-000000000004')$$,
         pg_temp.d('key-oper'), pg_temp.d('body-assign-3')),
  'serverErrors.cleaningNotForTech');

select pg_temp.as_server();
select pg_temp.check('null takes the executor off',
  (select (r -> 'body' ->> 'assignee_id') is null and r -> 'body' ->> 'status' = 'unassigned'
   from public.api_v1_assign_cleaning(pg_temp.d('key-oper'), 'idem-7', pg_temp.d('body-assign-4'),
          'a2810000-0000-4000-8000-000000000001', null) r),
  true);

-- ---------- 9. the panel: listing, changing, revoking ----------

select pg_temp.as_user('a2800003-0000-4000-8000-000000000003');
select pg_temp.raises('a manager may not list keys', 'select public.list_api_keys()', 'serverErrors.adminOnly');

select pg_temp.as_user('a2800002-0000-4000-8000-000000000002');
select pg_temp.check('an admin lists his company''s keys, every admin''s',
  (select count(*)::int from jsonb_array_elements(public.list_api_keys())), 8);
select pg_temp.check('the list never carries a digest',
  (select public.list_api_keys()::text like '%' || pg_temp.d('key-full') || '%'), false);

select pg_temp.as_user('a2800006-0000-4000-8000-000000000006');
select pg_temp.raises('another company''s admin cannot touch the key',
  format($$select public.update_api_key(%L::uuid, 'X', 'read_only', '{}', null)$$, :'k_oper'),
  'serverErrors.apiKeyNotFound');

select pg_temp.as_user('a2800002-0000-4000-8000-000000000002');
select public.update_api_key(:'k_oper'::uuid, 'Operator key', 'read_only', '{}', null);
select pg_temp.as_server();
select pg_temp.raises('a narrowed key loses the write at once',
  format($$select public.api_v1_create_task(%L, 'idem-8', %L, 'Late')$$,
         pg_temp.d('key-oper'), pg_temp.d('body-create-7')),
  'api:insufficient-scope');
select pg_temp.check('the change is journalled: who, before and after',
  (select e.actor_id::text || ' ' || (e.before ->> 'preset') || '>' || (e.after ->> 'preset')
   from public.api_key_events e where e.key_id = :'k_oper'::uuid and e.kind = 'updated'),
  'a2800002-0000-4000-8000-000000000002 operator>read_only');

select pg_temp.as_user('a2800002-0000-4000-8000-000000000002');
select pg_temp.raises('widening to full access asks for the name again',
  format($$select public.update_api_key(%L::uuid, 'Operator key', 'full', '{}', null)$$, :'k_oper'),
  'serverErrors.apiFullAccessUnconfirmed');
select pg_temp.raises('a forbidden scope cannot be added later either',
  format($$select public.update_api_key(%L::uuid, 'Operator key', 'custom', '{tenants:cross}', null)$$,
         :'k_oper'),
  'serverErrors.apiScopeForbidden');

select public.revoke_api_key(:'k_cust'::uuid);
select pg_temp.as_server();
select pg_temp.check('a revoked key is turned away at the gate',
  (select g ->> 'code' from public.api_gate(pg_temp.d('key-cust'), pg_temp.d('ip-9')) g), 'key-revoked');
select pg_temp.raises('and by the operation itself',
  format('select public.api_v1_list_cleanings(%L)', pg_temp.d('key-cust')), 'api:key-revoked');
select pg_temp.check('revoking is journalled',
  (select count(*)::int from public.api_key_events where key_id = :'k_cust'::uuid and kind = 'revoked'), 1);

update public.api_keys set expires_at = now() - interval '1 second' where id = :'k_sens'::uuid;
select pg_temp.check('an expired key is turned away',
  (select g ->> 'code' from public.api_gate(pg_temp.d('key-sens'), pg_temp.d('ip-9')) g), 'key-expired');

-- ---------- 10. the maker leaves ----------

select pg_temp.as_server();
update public.profiles set is_active = false where id = 'a2800002-0000-4000-8000-000000000002';
select pg_temp.check('a key whose maker is switched off is suspended',
  (select g ->> 'code' from public.api_gate(pg_temp.d('key-house'), pg_temp.d('ip-9')) g), 'key-suspended');
update public.profiles set is_active = true where id = 'a2800002-0000-4000-8000-000000000002';
update public.profiles set role = 'manager' where id = 'a2800002-0000-4000-8000-000000000002';
select pg_temp.check('so is one whose maker is no longer an admin',
  (select g ->> 'code' from public.api_gate(pg_temp.d('key-house'), pg_temp.d('ip-9')) g), 'key-suspended');
update public.profiles set role = 'admin' where id = 'a2800002-0000-4000-8000-000000000002';
select pg_temp.check('and it works again when he is back',
  (select g ->> 'ok' from public.api_gate(pg_temp.d('key-house'), pg_temp.d('ip-10')) g), 'true');

-- ---------- 11. the request log ----------

select public.api_log_request(:'k_full'::uuid, 'listCleanings', 'GET', 200, 12, null,
                              'a2890000-0000-4000-8000-000000000001');
select pg_temp.check('the log names the key and its company, and nothing of the request',
  (select l.host_id::text || ' ' || l.operation || ' ' || l.status
   from public.api_request_log l where l.request_id = 'a2890000-0000-4000-8000-000000000001'),
  'a2800000-0000-4000-8000-00000000000a listCleanings 200');
select pg_temp.check('the log has no column for a body, a query string or an IP',
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and table_name = 'api_request_log'
     and column_name ~ '(body|query|ip|header|key_digest|email)'),
  0);

-- ---------- 11b. what the review asked for ----------

select pg_temp.as_server();
select pg_temp.check('a code typed into what was reported is masked, and said so',
  (select (t ->> 'description') || ' / ' || (t ->> 'title') || ' / ' || (t ->> 'text_masked')
   from public.api_v1_get_task(pg_temp.d('key-full'), 'a2820000-0000-4000-8000-000000000003') t),
  'the lockbox does not open, try / Lockbox broken / true');
select pg_temp.check('a code beside other numbers takes only itself away',
  (select p ->> 'name' from public.api_v1_get_property(pg_temp.d('key-full'), 900281004) p),
  'Unit 4 - 2BR');
select pg_temp.check('a task with no code says so too',
  (select t ->> 'text_masked' from public.api_v1_get_task(pg_temp.d('key-full'), 'a2820000-0000-4000-8000-000000000001') t),
  'false');

select (:'created_2'::jsonb -> 'body' -> 'work' ->> 'cleaning_id') as repair_id \gset
select pg_temp.raises('cleanings:assign does not reach the repair of a task',
  format($$select public.api_v1_assign_cleaning(%L, 'idem-r1', %L, %L::uuid, 'a2800005-0000-4000-8000-000000000005')$$,
         pg_temp.d('key-full'), pg_temp.d('body-r1'), :'repair_id'),
  'api:rejected');

select pg_temp.check('a key limited to one room sees only that room of a booking',
  (select b -> 'room_ids' from public.api_v1_get_booking(pg_temp.d('key-room'), 900281501) b)::text,
  '[900281002]');
select pg_temp.check('an unlimited key sees every room of it',
  (select b -> 'room_ids' from public.api_v1_get_booking(pg_temp.d('key-full'), 900281501) b)::text,
  '[900281002, 900281004]');

select pg_temp.raises('the house key reads no media of the flat',
  format($$select public.api_v1_list_cleaning_media(%L, 'a2810000-0000-4000-8000-000000000001')$$,
         pg_temp.d('key-house')),
  'api:not-found');
select pg_temp.raises('nor assigns a task of the flat',
  format($$select public.api_v1_assign_task(%L, 'h-3', %L, 'a2820000-0000-4000-8000-000000000001',
           'a2800004-0000-4000-8000-000000000004')$$,
         pg_temp.d('key-house'), pg_temp.d('body-h3')),
  'api:not-found');

select pg_temp.raises('a null among the properties is refused',
  $$select public.create_api_key('a2800001-0000-4000-8000-000000000001', 'N', 'woom_nullAAA',
      pg_temp.d('key-n'), 'read_only', '{}', array[900281001, null]::bigint[])$$,
  'serverErrors.apiPropertiesEmpty');

select pg_temp.check('updated_at moves with a change of the key, not with its use',
  (select pg_get_triggerdef(t.oid) like '%UPDATE OF name, preset, scopes, property_ids, expires_at, revoked_at, revoked_by%'
   from pg_trigger t where t.tgname = 'api_keys_touch_updated_at'),
  true);

select pg_temp.as_server();
select pg_temp.check('one idempotency key under two API keys: two separate requests',
  (select r ->> 'status' from public.api_v1_create_task(pg_temp.d('key-full'), 'idem-1',
          pg_temp.d('body-other-key'), 'Another key, same idempotency key') r),
  '201');

select pg_temp.check('a day with two cleanings: the first page holds one and says there is more',
  (select string_agg(c ->> 'id', ',')
   from jsonb_array_elements(public.api_v1_list_cleanings(pg_temp.d('key-full'), p_date_from => '2026-11-02',
          p_date_to => '2026-11-02', p_property_id => 900281003, p_limit => 1)) c),
  'a2810000-0000-4000-8000-000000000001,a2810000-0000-4000-8000-000000000003');
select pg_temp.check('the next page starts after the same day''s first id',
  (select string_agg(c ->> 'id', ',')
   from jsonb_array_elements(public.api_v1_list_cleanings(pg_temp.d('key-full'), p_date_from => '2026-11-02',
          p_date_to => '2026-11-02', p_property_id => 900281003, p_after_date => '2026-11-02',
          p_after_id => 'a2810000-0000-4000-8000-000000000001', p_limit => 1)) c),
  'a2810000-0000-4000-8000-000000000003');

select pg_temp.raises('the gate refuses an address hash that is not one',
  $$select public.api_gate(null, 'not-hex')$$, null);
select pg_temp.check('no address, no bucket: the key is still checked',
  (select g ->> 'ok' from public.api_gate(pg_temp.d('key-full'), null) g), 'true');

select pg_temp.check('the nightly purge of API records is scheduled',
  (select count(*)::int from cron.job where jobname = 'purge-api-records'
     and command like '%api_request_log%' and command like '%api_idempotency%'),
  1);

-- ---------- 12. who may call what ----------

select pg_temp.check('service_role may call exactly the gate, the log, the operations and key making',
  (select string_agg(p.proname, ',' order by p.proname)
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and (p.proname like 'api\_%' or p.proname in ('create_api_key', 'list_api_keys', 'update_api_key',
          'revoke_api_key', 'list_api_key_events'))
     and has_function_privilege('service_role', p.oid, 'execute')),
  (select string_agg(n, ',' order by n) from unnest(array[
     'api_gate', 'api_log_request', 'create_api_key', 'api_v1_assign_cleaning', 'api_v1_assign_task',
     'api_v1_create_task', 'api_v1_get_booking', 'api_v1_get_cleaning', 'api_v1_get_me', 'api_v1_get_property',
     'api_v1_get_settings', 'api_v1_get_staff_member', 'api_v1_get_task', 'api_v1_list_bookings',
     'api_v1_list_cleaning_media', 'api_v1_list_cleanings', 'api_v1_list_properties', 'api_v1_list_staff',
     'api_v1_list_task_media', 'api_v1_list_tasks']) n));

select pg_temp.check('neither client role may call an operation or the gate',
  (select count(*)::int from pg_proc p, unnest(array['anon', 'authenticated']) r
   where p.pronamespace = 'public'::regnamespace
     and (p.proname like 'api\_v1\_%' or p.proname in ('api_gate', 'api_log_request', 'create_api_key',
          'api_act_as', 'api_authorize', 'api_idempotency_claim', 'api_idempotency_store'))
     and has_function_privilege(r, p.oid, 'execute')),
  0);
select pg_temp.check('service_role may call every operation, the gate and key making',
  (select bool_and(has_function_privilege('service_role', p.oid, 'execute'))
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and (p.proname like 'api\_v1\_%' or p.proname in ('api_gate', 'api_log_request', 'create_api_key'))),
  true);
select pg_temp.check('nobody but the operations may act as somebody',
  (select has_function_privilege('service_role', 'public.api_act_as(uuid)', 'execute')),
  false);
select pg_temp.check('the panel calls list, update, revoke and history as itself',
  (select bool_and(has_function_privilege('authenticated', p.oid, 'execute'))
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('list_api_keys', 'update_api_key', 'revoke_api_key', 'list_api_key_events')),
  true);
select pg_temp.check('no client role holds any privilege on the API tables',
  (select count(*)::int from pg_class c, unnest(array['anon', 'authenticated']) r,
          unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'trigger']) pr
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'api\_%'
     and has_table_privilege(r, c.oid, pr)),
  0);

rollback;
