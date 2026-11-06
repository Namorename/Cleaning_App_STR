-- Texts without the guest notice (20261102100000, docs/rollout-plan-1028.md §9.8): what
-- update_signal_settings and the table do with texts switched on without the notice —
-- before the migration, after it and after its rollback. REHEARSAL DATABASES ONLY: it
-- writes three companies and two admins of its own inside a transaction it rolls back.
-- The cloud's read-only role refuses it; never run it with db query --linked.
--
--   node rehearsal-db-1030.mjs rehearsal_<db> sql <plan tree>/docs/rollout/texts_boundary_1102_behaviour.sql
--
-- without_notice  texts on by the admin, no notice: 'accepted', or the hint of the refusal
--                 (serverErrors.signalTextsNeedNotice before the migration and after its rollback);
-- first_day       texts_enabled_at after that call: 'now', or 'no column';
-- with_notice     the same call with a notice dated yesterday: accepted in every state;
-- message         texts of messages on, no notice: refused (serverErrors.signalTextsNeedNotice) in
--                 every state — the step frees the reviews' texts only;
-- direct_write    a row written with texts on and neither date: the name of the check that
--                 refuses it.
begin;
create temp table probe_out (k text primary key, v text);
do $probe$
declare
  v_a       uuid := gen_random_uuid();
  v_b       uuid := gen_random_uuid();
  v_c       uuid := gen_random_uuid();
  v_admin_a uuid := gen_random_uuid();
  v_admin_b uuid := gen_random_uuid();
  v_out     text;
  v_has_col boolean := exists (select 1 from pg_attribute
                               where attrelid = 'public.signal_settings'::regclass
                                 and attname = 'texts_enabled_at' and not attisdropped);
begin
  insert into public.hosts (id, name, default_language) values
    (v_a, 'Probe host A', 'en'), (v_b, 'Probe host B', 'en'), (v_c, 'Probe host C', 'en');
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
  values
    (v_admin_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'probe.a@probe.local', 'x', now(), now(), '{"full_name":"Probe A"}'::jsonb, '{"role":"admin"}'::jsonb),
    (v_admin_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'probe.b@probe.local', 'x', now(), now(), '{"full_name":"Probe B"}'::jsonb, '{"role":"admin"}'::jsonb);
  update public.profiles set host_id = v_a where id = v_admin_a;
  update public.profiles set host_id = v_b where id = v_admin_b;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a, 'role', 'authenticated')::text, true);
  begin
    perform public.update_signal_settings(p_texts_enabled => true);
    v_out := 'accepted';
  exception when others then get stacked diagnostics v_out = pg_exception_hint;
  end;
  insert into probe_out values ('without_notice', v_out);
  if v_has_col then
    execute 'select case when texts_enabled_at = now() then ''now'' else coalesce(texts_enabled_at::text, ''null'') end
             from public.signal_settings where host_id = $1 and kind = ''review'''
      into v_out using v_a;
    v_out := coalesce(v_out, 'no row');
  else
    v_out := 'no column';
  end if;
  insert into probe_out values ('first_day', v_out);

  begin
    perform public.update_signal_settings(p_texts_enabled => true, p_kind => 'message');
    v_out := 'accepted';
  exception when others then get stacked diagnostics v_out = pg_exception_hint;
  end;
  insert into probe_out values ('message', v_out);

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_b, 'role', 'authenticated')::text, true);
  begin
    perform public.update_signal_settings(p_texts_enabled => true, p_notice_published_at => now() - interval '1 day');
    v_out := 'accepted';
  exception when others then get stacked diagnostics v_out = pg_exception_hint;
  end;
  insert into probe_out values ('with_notice', v_out);

  perform set_config('request.jwt.claims', '{}', true);
  begin
    insert into public.signal_settings (host_id, kind, texts_enabled) values (v_c, 'review', true);
    v_out := 'accepted';
  exception when check_violation then get stacked diagnostics v_out = constraint_name;
  end;
  insert into probe_out values ('direct_write', v_out);
end $probe$;
select json_object_agg(k, v order by k) from probe_out;
rollback;
