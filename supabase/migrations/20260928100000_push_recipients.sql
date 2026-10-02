-- F11, M1: who receives a push and which ones she wants (docs/f11-plan.md, §3.1
-- and §4 M1).
--
-- Two tables and three RPCs, nothing else:
--
-- - push_tokens: the Expo token of each phone and the person signed in on it. A
--   token is the phone's, not the person's, so registering moves it to whoever
--   signed in last: on a shared phone the previous person's pushes stop at once.
--   Clients hold no privilege on it at all — a token is the address of somebody
--   else's phone — and reach it only through register/unregister.
--
-- - push_preferences: the events a person has switched OFF. Keeping the muted
--   list rather than the wanted one means an event added after launch reaches
--   everybody without a data migration, and a person who never opened the
--   settings has no row and gets everything. The sender checks this list at the
--   moment of sending (M3), so the phone never hides a push on its own. The
--   person reads her own row for the settings screen; writing goes through
--   set_push_preference, which takes the wanted VALUE — a replay from the
--   offline queue lands where the first call did, which a toggle would not.
--
-- The language a push is written in is profiles.preferred_language, which a
-- person may already set on her own row (supabase/tests/profile_language.sql);
-- push_tokens.language is only the phone's language, the fallback when the
-- profile has none.
--
-- New tables only; the foreign keys take a brief lock on profiles and hosts.

set local lock_timeout = '3s';

-- ---------- the events ----------

-- One value per push the owner approved on 2026-09-28, in the order the
-- settings screen lists them.
create type public.push_kind as enum (
  'cleaning_new',            -- a cleaning within the week was created for her
  'cleaning_assigned',       -- a cleaning was given to her
  'cleaning_unassigned',     -- a cleaning was taken from her
  'cleaning_cancelled',      -- her cleaning was cancelled
  'cleaning_moved',          -- her cleaning moved to another day or room (booking or office)
  'cleaning_window',         -- the hours of her cleaning today or tomorrow changed
  'cleaning_free',           -- a free cleaning appeared on her listings
  'booking_cancelled_live',  -- the booking was cancelled while she is cleaning
  'chat_message',            -- a message in a conversation she is part of
  'daily_digest'             -- the morning summary
);

comment on type public.push_kind is
  'The events that send a push (docs/f11-plan.md §1). push_preferences.muted '
  'lists the ones a person switched off.';

-- ---------- push_tokens ----------

create table public.push_tokens (
  token        text primary key
               -- Expo's own test (expo-server-sdk isExpoPushToken): the prefix,
               -- the brackets, anything but a bracket inside.
               check (token ~ '^Expo(nent)?PushToken\[[^]]{1,200}\]$'),
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  host_id      uuid not null references public.hosts (id),
  platform     text not null check (platform in ('ios', 'android')),
  -- The phone's language; the profile's preferred_language wins over it.
  language     public.app_language,
  app_version  text check (length(app_version) <= 32),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index push_tokens_profile_idx on public.push_tokens (profile_id, updated_at desc);

comment on table public.push_tokens is
  'Expo push token of each phone and the person signed in on it. Closed to '
  'clients; written by register_push_token/unregister_push_token only.';

alter table public.push_tokens enable row level security;
revoke all on public.push_tokens from public, anon, authenticated;

-- ---------- push_preferences ----------

create table public.push_preferences (
  profile_id  uuid primary key references public.profiles (id) on delete cascade,
  host_id     uuid not null references public.hosts (id),
  muted       public.push_kind[] not null default '{}',
  updated_at  timestamptz not null default now()
);

comment on table public.push_preferences is
  'The push events a person switched off. No row: everything is on. Read by '
  'the person herself; written by set_push_preference only.';

alter table public.push_preferences enable row level security;
revoke all on public.push_preferences from public, anon, authenticated;
grant select on public.push_preferences to authenticated;

create policy "person reads own push preferences"
  on public.push_preferences
  for select
  to authenticated
  using (profile_id = (select auth.uid()) and (select public.is_active_user()));

-- ---------- how many phones a person keeps ----------

create or replace function public.push_tokens_per_person()
returns int
language sql
immutable
parallel safe
set search_path = ''
as $$
  select 5
$$;

comment on function public.push_tokens_per_person() is
  'At most this many phones per person; registering one more lets go of the '
  'one used longest ago.';

-- ---------- register_push_token ----------

create or replace function public.register_push_token(
  p_token       text,
  p_platform    text,
  p_language    public.app_language default null,
  p_app_version text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid := (select auth.uid());
  v_host uuid;
begin
  select p.host_id into v_host
  from public.profiles p
  where p.id = v_me and p.is_active;
  if v_host is null then
    raise exception 'Only an active person can register a phone'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.notSignedIn';
  end if;

  -- On conflict the token MOVES: the phone now belongs to whoever signed in on
  -- it last, in whichever company she works.
  insert into public.push_tokens (token, profile_id, host_id, platform, language, app_version)
  values (p_token, v_me, v_host, p_platform, p_language, p_app_version)
  on conflict (token) do update
    set profile_id  = excluded.profile_id,
        host_id     = excluded.host_id,
        platform    = excluded.platform,
        language    = excluded.language,
        app_version = excluded.app_version,
        updated_at  = now();

  delete from public.push_tokens t
  where t.profile_id = v_me
    and t.token not in (
      select k.token
      from public.push_tokens k
      where k.profile_id = v_me
      order by k.updated_at desc, k.token
      limit public.push_tokens_per_person()
    );
end;
$$;

comment on function public.register_push_token(text, text, public.app_language, text) is
  'The signed-in person registers the Expo token of her phone. Idempotent; a '
  'token held by someone else moves to her.';

-- ---------- unregister_push_token ----------

-- No is_active test: a dismissed person signing out is exactly the one who
-- should stop getting pushes.
create or replace function public.unregister_push_token(p_token text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_tokens t
  where t.token = p_token
    and t.profile_id = (select auth.uid())
$$;

comment on function public.unregister_push_token(text) is
  'The signed-in person lets go of her phone''s token before signing out. '
  'Someone else''s token is left alone; a replay is harmless.';

-- ---------- set_push_preference ----------

create or replace function public.set_push_preference(
  p_kind    public.push_kind,
  p_enabled boolean
)
returns public.push_preferences
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid := (select auth.uid());
  v_host uuid;
  v_row  public.push_preferences;
begin
  if p_kind is null or p_enabled is null then
    raise exception 'set_push_preference needs a kind and a value'
      using errcode = 'null_value_not_allowed';
  end if;

  select p.host_id into v_host
  from public.profiles p
  where p.id = v_me and p.is_active;
  if v_host is null then
    raise exception 'Only an active person can change her pushes'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.notSignedIn';
  end if;

  -- The list is kept distinct and in the order of the kinds, so the same
  -- choice always reads the same whatever order it was made in.
  insert into public.push_preferences as pp (profile_id, host_id, muted)
  values (v_me, v_host,
          case when p_enabled then '{}'::public.push_kind[] else array[p_kind] end)
  on conflict (profile_id) do update
    set muted = (
          select coalesce(array_agg(distinct k order by k), '{}'::public.push_kind[])
          from unnest(case when p_enabled then array_remove(pp.muted, p_kind)
                           else pp.muted || p_kind end) as k
        ),
        host_id    = excluded.host_id,
        updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.set_push_preference(public.push_kind, boolean) is
  'The signed-in person switches one push event on or off. Takes the wanted '
  'value, so a replay is harmless. Returns her row.';

-- ---------- grants ----------

revoke all on function public.push_tokens_per_person() from public, anon;
revoke all on function public.register_push_token(text, text, public.app_language, text) from public, anon;
revoke all on function public.unregister_push_token(text) from public, anon;
revoke all on function public.set_push_preference(public.push_kind, boolean) from public, anon;

grant execute on function public.push_tokens_per_person() to authenticated, service_role;
grant execute on function public.register_push_token(text, text, public.app_language, text) to authenticated, service_role;
grant execute on function public.unregister_push_token(text) to authenticated, service_role;
grant execute on function public.set_push_preference(public.push_kind, boolean) to authenticated, service_role;
