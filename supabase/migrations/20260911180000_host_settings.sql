-- The switches that belong to the company rather than to a listing.
--
-- Two of them so far, and they were in two different states of unfinished:
-- `parallel_start_allowed` has been read by `start_task` since F6 but had no
-- screen to set it from, and the gallery has been a comment in the phone's
-- capture module — "the setting that would allow the gallery lives with the
-- manager (F10)" — with nothing behind it. F10 stage 6 gives both a screen,
-- and a screen needs a way in: `hosts` is readable by the whole staff and
-- writable by nobody, so the panel could not save either one.
--
-- Why the gallery starts closed. Every photograph the app has ever taken came
-- from the camera at the moment of the cleaning, which is what makes it
-- evidence of the state of the flat. Allowing the gallery lets a picture from
-- another flat, or from last week, stand in for that — a real loosening of a
-- real rule, and not one a migration gets to perform on a company's behalf
-- while it sleeps. `default false` keeps every existing company exactly where
-- it is; the owner opens it deliberately, having read what it costs.
--
-- One switch for photographs and video together: a still and a clip can be
-- substituted in precisely the same way, so splitting them would be two
-- controls for one decision.

alter table public.hosts
  add column gallery_allowed boolean not null default false;

comment on column public.hosts.gallery_allowed is
  'May cleaners attach photos and video from the phone gallery as well as the camera. Off by default: a file from the gallery is not evidence of the flat at the time of the cleaning.';

/**
 * Write the company's switches.
 *
 * Every parameter is optional and null means "not part of this call" rather
 * than "set to null" — the columns are `not null`, and a panel sending one
 * switch must not carry an implicit answer about the other. Two managers on
 * two screens can each save the control they touched.
 *
 * Managers only, and only their own company: the row is found through
 * `current_host_id()`, never named by the caller.
 */
create or replace function public.update_host_settings(
  p_parallel_start_allowed boolean default null,
  p_gallery_allowed        boolean default null
)
returns public.hosts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host uuid := public.current_host_id();
  v_row  public.hosts;
begin
  if not public.is_manager() then
    raise exception 'Only a manager may change company settings'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;

  update public.hosts h
  set parallel_start_allowed = coalesce(p_parallel_start_allowed, h.parallel_start_allowed),
      gallery_allowed        = coalesce(p_gallery_allowed, h.gallery_allowed)
  where h.id = v_host
  returning * into v_row;

  if not found then
    raise exception 'Company % is not there', v_host
      using errcode = 'no_data_found', hint = 'serverErrors.hostNotFound';
  end if;

  return v_row;
end;
$$;

revoke all on function public.update_host_settings(boolean, boolean) from public, anon;
grant execute on function public.update_host_settings(boolean, boolean)
  to authenticated, service_role;
