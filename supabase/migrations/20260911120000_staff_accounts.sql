-- The team section: the login the panel can show, and a refusal it can read.
--
-- Two gaps stood between the panel and a /team screen.
--
-- 1. The login is not readable. A person signs in with an email address, and
--    that address lives in auth.users. PostgREST serves the public schema
--    only, and opening auth.users to `authenticated` would hand out every
--    account's password hash and refresh tokens along with it. The address is
--    mirrored into profiles instead: auth stays its owner, triggers keep the
--    copy honest, and no client may write it — an address is changed through
--    auth, with confirmation on both sides, and a write here would only make
--    the panel show something that is not true.
--
-- 2. "One automatic cleaner per listing" answers in index names. The partial
--    unique index property_cleaners_one_auto (20260901140000) is the right
--    rule, but written straight from the panel the second automatic cleaner
--    comes back as `duplicate key value violates unique constraint
--    "property_cleaners_one_auto"`, which is not an answer to give a person.
--    save_property_cleaner asks the question first and raises the translated
--    key, naming whoever already holds the listing so the manager knows whom
--    to release.
--
-- Everything that touches auth.users — creating an account, changing a role,
-- generating a password — belongs to the Edge Function `manage-staff` and its
-- Admin API, not here. A role has to land in two places at once: app_metadata,
-- which the panel guard reads out of the token, and profiles.role, which row
-- security reads; only the function can write both, and a migration that let
-- the panel write one of them would guarantee they drift apart.

-- ---------- 1. the login, mirrored where the panel can read it ----------

alter table public.profiles
  add column email text;

comment on column public.profiles.email is
  'Mirror of auth.users.email — the address the person signs in with. Written by triggers only; auth owns it.';

-- A backfill is not an edit: bumping updated_at on every row would make the
-- whole company look as if it had just been changed by hand.
alter table public.profiles disable trigger profiles_touch;

update public.profiles p
   set email = u.email
  from auth.users u
 where u.id = p.id
   and p.email is distinct from u.email;

alter table public.profiles enable trigger profiles_touch;

-- Unchanged from 20260824190100 except that the address comes along with the
-- new account. `coalesce` on conflict keeps a profile that was written ahead
-- of the account from losing what it already knows.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role, email)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(
      -- An unknown value must not bring registration down:
      -- fall back to the most restricted role.
      (select r from unnest(enum_range(null::public.app_role)) r
        where r::text = new.raw_app_meta_data ->> 'role'),
      'cleaner'
    ),
    new.email
  )
  -- The profile may have been created ahead of time (an invite from the panel).
  -- Without on conflict GoTrue would return an opaque 500.
  on conflict (id) do update
    set full_name = coalesce(excluded.full_name, public.profiles.full_name),
        email     = coalesce(excluded.email, public.profiles.email);
  return new;
end;
$$;

/**
 * Keep the mirrored login in step with auth.
 *
 * Fires only when the address actually changed, so the ordinary auth.users
 * traffic — every sign-in rewrites last_sign_in_at — does not touch profiles.
 */
create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (new.email is distinct from old.email)
  execute function public.sync_profile_email();

-- Unchanged from 20260824190100 except that the login joins the fields a
-- client may not rewrite. Not only the cleaner: a manager cannot write it
-- either, because the column is a copy and the original is elsewhere. The
-- server context — the trigger above, the Edge Function, a migration — has no
-- auth.uid() and passes straight through.
create or replace function public.guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  new.email := old.email;

  if not public.is_manager() then
    new.role := old.role;
    new.is_active := old.is_active;
  end if;

  return new;
end;
$$;

-- ---------- 2. who cleans a listing ----------

/**
 * Link a cleaner to a listing, or change the terms of an existing link.
 *
 * Idempotent on the pair (listing, cleaner): the panel sends the whole state
 * of the row it is editing, and a repeat writes the same thing again.
 *
 * The mode is the arrangement, not a preference: 'auto' hands the listing's
 * work to this person the moment it is generated, 'claim' puts it in a queue
 * the linked cleaners share. Only one person can be the automatic one, which
 * is where the refusal below comes from.
 */
create or replace function public.save_property_cleaner(
  p_property_id bigint,
  p_cleaner_id  uuid,
  p_mode        public.assignment_mode default 'claim',
  -- integer rather than smallint: PostgREST hands JSON numbers over as
  -- integers, and a smallint parameter makes it look for an overload.
  p_priority    integer default 1
)
returns public.property_cleaners
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host   uuid := public.current_host_id();
  v_row    public.property_cleaners;
  v_holder text;
begin
  if not public.is_manager() then
    raise exception 'Only a manager may say who cleans a listing'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;

  if not exists (select 1 from public.properties pr
                 where pr.id = p_property_id and pr.host_id = v_host) then
    raise exception 'Listing % is not in this company', p_property_id
      using errcode = 'check_violation', hint = 'serverErrors.propertyNotFound';
  end if;

  if not exists (select 1 from public.profiles pf
                 where pf.id = p_cleaner_id and pf.host_id = v_host) then
    raise exception 'Person % is not in this company', p_cleaner_id
      using errcode = 'check_violation', hint = 'serverErrors.staffNotFound';
  end if;

  -- 1 is the listing's main cleaner; the ceiling only keeps the number a
  -- position in a short list rather than an arbitrary integer.
  if p_priority is null or p_priority < 1 or p_priority > 99 then
    raise exception 'Priority % is outside 1..99', p_priority
      using errcode = 'check_violation', hint = 'serverErrors.cleanerPriorityInvalid';
  end if;

  if p_mode = 'auto' then
    select coalesce(pf.full_name, pf.email) into v_holder
    from public.property_cleaners pc
    join public.profiles pf on pf.id = pc.cleaner_id
    where pc.property_id = p_property_id
      and pc.mode = 'auto'
      and pc.cleaner_id <> p_cleaner_id;

    if found then
      raise exception 'Listing % already hands its work to %', p_property_id, v_holder
        using errcode = 'unique_violation',
              hint = 'serverErrors.cleanerAutoTaken',
              detail = jsonb_build_object('name', coalesce(v_holder, ''))::text;
    end if;
  end if;

  insert into public.property_cleaners (host_id, property_id, cleaner_id, mode, priority)
  values (v_host, p_property_id, p_cleaner_id, p_mode, p_priority::smallint)
  on conflict (property_id, cleaner_id) do update
    set mode     = excluded.mode,
        priority = excluded.priority
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function
  public.save_property_cleaner(bigint, uuid, public.assignment_mode, integer)
  from public, anon;
grant execute on function
  public.save_property_cleaner(bigint, uuid, public.assignment_mode, integer)
  to authenticated, service_role;
