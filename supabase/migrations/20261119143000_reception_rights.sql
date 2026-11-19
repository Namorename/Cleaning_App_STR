-- The reception's rights (the owner's request of 2026-11-19, CORE;
-- docs/panel-edits-reception-1119.md §5).
--
-- «Everything a manager can, but»: no manager boards (the technicians' board, «Задания», stays), no
-- «Команда», and of the settings only her own and «Процесс». The rule is written the way the owner
-- said it: the office grows by one role, and the three exceptions are closed on their own.
--
-- - is_manager() — the office: a manager, an admin, the reception. Every rule that reads it lets the
--   reception through, as it lets a manager: tasks, cleanings, Guests, the calendar, analytics,
--   supplies, properties, the knowledge base, chats.
-- - is_full_manager() — a manager or an admin, what is_manager() was until now. It guards what the
--   reception may not reach:
--   * the boards: the read policies of their four tables and every board function that checks the
--     role (the others reach the row through these: manager_board_for_cards, manager_card_for_edit,
--     manager_step_card, manager_board_for_edit);
--   * the profiles: writing another's row («Команда») and changing a role or switching somebody off
--     (guard_profile_privileges — else she could make herself a manager);
--   * the gates of guest signals (update_signal_settings), and the company's switches in
--     update_host_settings; its video limits are «Процесс» and stay hers.
-- - Where the office is named by role in a body, the reception joins the manager and the admin: who
--   takes part in chats, who reads a guest's message, who hears a cleaning declined or interrupted,
--   who closed a job, whose word a journal line is. A board card's assignee and a plan step's are
--   still a manager or an admin.
--
-- Only function bodies and five policies change; signatures, owners and grants stay. The bodies are
-- the current ones (the probes of 20261118230000 and 20261119090000 matched them with the cloud)
-- with the role check alone changed. Nobody holds the role yet: until «Команда» hands it out, every
-- caller is answered as before.

set local lock_timeout = '3s';

create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.auth_role() in ('manager', 'admin', 'reception'), false)
$$;

comment on function public.is_manager() is
  'The office: an active manager, admin or reception of the caller''s company (20261119143000).';

create function public.is_full_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.auth_role() in ('manager', 'admin'), false)
$$;

comment on function public.is_full_manager() is
  'An active manager or admin: the boards, «Команда» and the company''s switches, which the reception does not reach (20261119143000).';

revoke all on function public.is_full_manager() from public, anon;
grant execute on function public.is_full_manager() to authenticated, service_role;

-- ---------- policies: the boards and the profiles ----------

alter policy "the office reads the company's boards" on public.manager_boards
  using ((select public.is_full_manager()) and host_id = (select public.current_host_id()));
alter policy "the office reads the company's board cards" on public.manager_board_cards
  using ((select public.is_full_manager()) and host_id = (select public.current_host_id()));
alter policy "the office reads the company's board steps" on public.manager_board_steps
  using ((select public.is_full_manager()) and host_id = (select public.current_host_id()));
alter policy "the office reads the company's board journals" on public.manager_board_entries
  using ((select public.is_full_manager()) and host_id = (select public.current_host_id()));
alter policy "managers manage profiles" on public.profiles
  using (public.is_full_manager() and host_id = public.current_host_id())
  with check (public.is_full_manager() and host_id = public.current_host_id());

-- ---------- the company's switches: a manager's or an admin's; the video limits the reception's too ----------

CREATE OR REPLACE FUNCTION public.update_host_settings(p_parallel_start_allowed boolean DEFAULT NULL::boolean, p_gallery_allowed boolean DEFAULT NULL::boolean, p_video_max_sec integer DEFAULT NULL::integer, p_video_bitrate_kbps integer DEFAULT NULL::integer, p_video_max_mb integer DEFAULT NULL::integer)
 RETURNS hosts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_host uuid := public.current_host_id();
  v_row  public.hosts;
begin
  if not public.is_manager() then
    raise exception 'Only a manager may change company settings'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;
  -- The company's switches are a manager's or an admin's; the video limits («Процесс») the
  -- reception's too (20261119143000).
  if not public.is_full_manager()
     and (p_parallel_start_allowed is not null or p_gallery_allowed is not null) then
    raise exception 'Only a manager or an admin changes the company switches'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;

  -- The bounds of hosts_video_*_range.
  if p_video_max_sec is not null and p_video_max_sec not between 10 and 600 then
    raise exception 'video_max_sec % is outside 10..600', p_video_max_sec
      using errcode = 'check_violation',
            hint = 'serverErrors.videoSettingOutOfRange',
            detail = jsonb_build_object('field', 'video_max_sec', 'min', 10, 'max', 600)::text;
  end if;
  if p_video_bitrate_kbps is not null and p_video_bitrate_kbps not between 500 and 20000 then
    raise exception 'video_bitrate_kbps % is outside 500..20000', p_video_bitrate_kbps
      using errcode = 'check_violation',
            hint = 'serverErrors.videoSettingOutOfRange',
            detail = jsonb_build_object('field', 'video_bitrate_kbps', 'min', 500, 'max', 20000)::text;
  end if;
  if p_video_max_mb is not null and p_video_max_mb not between 5 and 150 then
    raise exception 'video_max_mb % is outside 5..150', p_video_max_mb
      using errcode = 'check_violation',
            hint = 'serverErrors.videoSettingOutOfRange',
            detail = jsonb_build_object('field', 'video_max_mb', 'min', 5, 'max', 150)::text;
  end if;

  update public.hosts h
  set parallel_start_allowed = coalesce(p_parallel_start_allowed, h.parallel_start_allowed),
      gallery_allowed        = coalesce(p_gallery_allowed, h.gallery_allowed),
      video_max_sec          = coalesce(p_video_max_sec, h.video_max_sec),
      video_bitrate_kbps     = coalesce(p_video_bitrate_kbps, h.video_bitrate_kbps),
      video_max_mb           = coalesce(p_video_max_mb, h.video_max_mb)
  where h.id = v_host
  returning * into v_row;

  if not found then
    raise exception 'Company % is not there', v_host
      using errcode = 'no_data_found', hint = 'serverErrors.hostNotFound';
  end if;

  return v_row;
end;
$function$;

-- ---------- boards, profiles and the gates of guest signals: a manager or an admin ----------

CREATE OR REPLACE FUNCTION public.manager_board_for_cards(p_board_id uuid)
 RETURNS manager_boards
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_board public.manager_boards;
begin
  if not public.is_full_manager() then
    raise exception 'Only a manager may do this'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;

  select b.* into v_board
  from public.manager_boards b
  where b.id = p_board_id
    and b.host_id = public.current_host_id()
  for share;

  if not found then
    raise exception 'Board % not found', p_board_id
      using errcode = 'no_data_found', hint = 'serverErrors.boardNotFound';
  end if;
  if v_board.archived_at is not null then
    raise exception 'Board % is archived', p_board_id
      using errcode = 'check_violation', hint = 'serverErrors.boardArchived';
  end if;
  return v_board;
end;
$function$;

CREATE OR REPLACE FUNCTION public.manager_board_for_edit(p_board_id uuid, p_archived_ok boolean)
 RETURNS manager_boards
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_board public.manager_boards;
begin
  if not public.is_full_manager() then
    raise exception 'Only a manager may do this'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;

  select b.* into v_board
  from public.manager_boards b
  where b.id = p_board_id
    and b.host_id = public.current_host_id()
  for share;

  if not found then
    raise exception 'Board % not found', p_board_id
      using errcode = 'no_data_found', hint = 'serverErrors.boardNotFound';
  end if;
  if v_board.owner_id is distinct from (select auth.uid())
     and public.auth_role() is distinct from 'admin' then
    raise exception 'Only the owner of board % or an admin may change it', p_board_id
      using errcode = 'insufficient_privilege', hint = 'serverErrors.boardNotYours';
  end if;
  if v_board.archived_at is not null and not p_archived_ok then
    raise exception 'Board % is archived', p_board_id
      using errcode = 'check_violation', hint = 'serverErrors.boardArchived';
  end if;
  return v_board;
end;
$function$;

CREATE OR REPLACE FUNCTION public.manager_card_for_edit(p_card_id uuid, p_shelved_ok boolean)
 RETURNS manager_board_cards
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_board_id uuid;
  v_card     public.manager_board_cards;
begin
  if not public.is_full_manager() then
    raise exception 'Only a manager may do this'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;

  select c.board_id into v_board_id
  from public.manager_board_cards c
  where c.id = p_card_id
    and c.host_id = public.current_host_id();

  if not found then
    raise exception 'Card % not found', p_card_id
      using errcode = 'no_data_found', hint = 'serverErrors.boardCardNotFound';
  end if;

  -- Every manager and admin of the company, on a board that is not archived (20261119090000).
  perform public.manager_board_for_cards(v_board_id);

  select c.* into v_card
  from public.manager_board_cards c
  where c.id = p_card_id
  for update;

  if (v_card.archived_at is not null or v_card.deleted_at is not null) and not p_shelved_ok then
    raise exception 'Card % is archived or deleted', p_card_id
      using errcode = 'check_violation', hint = 'serverErrors.boardCardShelved';
  end if;
  return v_card;
end;
$function$;

CREATE OR REPLACE FUNCTION public.manager_step_card(p_step_id uuid)
 RETURNS manager_board_cards
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_card_id uuid;
begin
  if not public.is_full_manager() then
    raise exception 'Only a manager may do this'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;
  select s.card_id into v_card_id
  from public.manager_board_steps s
  where s.id = p_step_id and s.host_id = public.current_host_id();
  if not found then
    raise exception 'Step % not found', p_step_id
      using errcode = 'no_data_found', hint = 'serverErrors.boardStepNotFound';
  end if;
  return public.manager_card_for_edit(v_card_id, false);
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_manager_board(p_id uuid, p_title text)
 RETURNS manager_boards
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_title text := btrim(coalesce(p_title, ''), E' \t\r\n');
  v_board public.manager_boards;
begin
  if not public.is_full_manager() then
    raise exception 'Only a manager may do this'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;
  if p_id is null then
    raise exception 'A board needs an id' using errcode = 'invalid_parameter_value', hint = 'serverErrors.unknown';
  end if;
  if char_length(v_title) not between 1 and 80 then
    raise exception 'A board needs a title of up to 80 characters'
      using errcode = 'check_violation', hint = 'serverErrors.boardTitleInvalid',
            detail = jsonb_build_object('max', 80)::text;
  end if;

  -- A board of another company with this id is not found: the insert does nothing, and the
  -- rights below look in the caller's company only.
  insert into public.manager_boards (id, host_id, title, owner_id)
  values (p_id, public.current_host_id(), v_title, (select auth.uid()))
  on conflict (id) do nothing;

  -- The row is written below: taken for update first, so two saves of one board queue rather
  -- than each holding the share the other's update waits for.
  perform 1 from public.manager_boards b
  where b.id = p_id and b.host_id = public.current_host_id()
  for update;
  v_board := public.manager_board_for_edit(p_id, false);
  if v_board.title is distinct from v_title then
    update public.manager_boards b
    set title = v_title, updated_at = now()
    where b.id = p_id
    returning b.* into v_board;
  end if;
  return v_board;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_manager_card(p_id uuid, p_board_id uuid, p_title text, p_description text, p_due_on date, p_property_id bigint, p_color text, p_column text DEFAULT NULL::text, p_steps jsonb DEFAULT NULL::jsonb)
 RETURNS manager_board_cards
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_title       text := btrim(coalesce(p_title, ''), E' \t\r\n');
  v_description text := coalesce(p_description, '');
  v_column      text := coalesce(p_column, 'open');
  v_card        public.manager_board_cards;
  v_board       public.manager_boards;
  v_known       boolean;
  v_step        jsonb;
begin
  if not public.is_full_manager() then
    raise exception 'Only a manager may do this'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;
  if p_id is null then
    raise exception 'A card needs an id' using errcode = 'invalid_parameter_value', hint = 'serverErrors.unknown';
  end if;
  if char_length(v_title) not between 1 and 200 then
    raise exception 'A card needs a title of up to 200 characters'
      using errcode = 'check_violation', hint = 'serverErrors.boardCardTitleInvalid',
            detail = jsonb_build_object('max', 200)::text;
  end if;
  if char_length(v_description) > 10000 then
    raise exception 'A description is at most 10000 characters'
      using errcode = 'check_violation', hint = 'serverErrors.boardCardDescriptionTooLong',
            detail = jsonb_build_object('max', 10000)::text;
  end if;
  if p_color is not null
     and p_color not in ('blue', 'sky', 'teal', 'green', 'olive', 'violet', 'orchid', 'slate') then
    raise exception 'Unknown card colour %', p_color
      using errcode = 'invalid_parameter_value', hint = 'serverErrors.boardColorUnknown';
  end if;
  perform public.manager_board_column(v_column);
  if p_property_id is not null and not exists (
    select 1 from public.properties p
    where p.id = p_property_id and p.host_id = public.current_host_id()
  ) then
    raise exception 'Property % not found', p_property_id
      using errcode = 'no_data_found', hint = 'serverErrors.propertyNotFound';
  end if;
  if p_steps is not null then
    if jsonb_typeof(p_steps) <> 'array' then
      raise exception 'Steps must be an array of their words'
        using errcode = 'invalid_parameter_value', hint = 'serverErrors.boardStepInvalid',
              detail = jsonb_build_object('max', 500)::text;
    end if;
    if jsonb_array_length(p_steps) > 100 then
      raise exception 'A card holds up to 100 steps'
        using errcode = 'check_violation', hint = 'serverErrors.boardTooManySteps',
              detail = jsonb_build_object('max', 100)::text;
    end if;
    for v_step in select value from jsonb_array_elements(p_steps) loop
      if jsonb_typeof(v_step) <> 'string'
         or char_length(btrim(v_step #>> '{}', E' \t\r\n')) not between 1 and 500 then
        raise exception 'A step needs words, up to 500 characters'
          using errcode = 'check_violation', hint = 'serverErrors.boardStepInvalid',
                detail = jsonb_build_object('max', 500)::text;
      end if;
    end loop;
  end if;

  select exists (select 1 from public.manager_board_cards c where c.id = p_id) into v_known;

  if not v_known then
    -- Any manager or admin of the company makes a card on a live board (20261119090000).
    v_board := public.manager_board_for_cards(p_board_id);
    insert into public.manager_board_cards
      (id, host_id, board_id, title, description, column_key, color, due_on, property_id, created_by,
       assignee_id)
    values
      (p_id, v_board.host_id, v_board.id, v_title, v_description, v_column, p_color, p_due_on,
       p_property_id, (select auth.uid()),
       -- The owner, if they can hold a card: an active manager or admin of the company.
       (select p.id from public.profiles p
        where p.id = v_board.owner_id and p.host_id = v_board.host_id and p.is_active
          and p.role in ('manager', 'admin')))
    on conflict (id) do nothing
    returning * into v_card;

    if v_card.id is not null then
      insert into public.manager_board_steps (id, host_id, card_id, body, sort_order, created_by)
      select gen_random_uuid(), v_card.host_id, v_card.id, btrim(s.body, E' \t\r\n'), s.n::integer,
             (select auth.uid())
      from jsonb_array_elements_text(coalesce(p_steps, '[]'::jsonb)) with ordinality s(body, n);
      return v_card;
    end if;
    -- Saved meanwhile by a repeat: it is a repeat of the create, below.
  end if;

  if p_column is not null then
    -- A repeat of a create: the card as it stands, if it is the caller's company's.
    select c.* into v_card
    from public.manager_board_cards c
    where c.id = p_id and c.host_id = public.current_host_id();
    if not found then
      raise exception 'Card % not found', p_id
        using errcode = 'no_data_found', hint = 'serverErrors.boardCardNotFound';
    end if;
    return v_card;
  end if;

  v_card := public.manager_card_for_edit(p_id, false);

  if v_card.due_on is distinct from p_due_on then
    insert into public.manager_board_entries (id, host_id, card_id, kind, facts, author_id)
    values (gen_random_uuid(), v_card.host_id, v_card.id, 'due_changed',
            jsonb_build_object('from', v_card.due_on, 'to', p_due_on), (select auth.uid()));
  end if;

  if (v_card.title, v_card.description, v_card.color, v_card.due_on, v_card.property_id)
     is distinct from (v_title, v_description, p_color, p_due_on, p_property_id) then
    update public.manager_board_cards c
    set title       = v_title,
        description = v_description,
        color       = p_color,
        due_on      = p_due_on,
        property_id = p_property_id,
        updated_at  = now()
    where c.id = v_card.id
    returning c.* into v_card;
  end if;
  return v_card;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_manager_comment(p_id uuid, p_card_id uuid, p_body text)
 RETURNS manager_board_entries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_body  text := btrim(coalesce(p_body, ''), E' \t\r\n');
  v_card  public.manager_board_cards;
  v_entry public.manager_board_entries;
begin
  if not public.is_full_manager() then
    raise exception 'Only a manager may do this'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;
  if p_id is null then
    raise exception 'A comment needs an id' using errcode = 'invalid_parameter_value', hint = 'serverErrors.unknown';
  end if;
  if v_body = '' then
    raise exception 'A comment needs words'
      using errcode = 'check_violation', hint = 'serverErrors.commentEmpty';
  end if;
  if char_length(v_body) > 4000 then
    raise exception 'A comment is at most 4000 characters'
      using errcode = 'check_violation', hint = 'serverErrors.commentTooLong',
            detail = jsonb_build_object('limit', 4000)::text;
  end if;

  select e.* into v_entry
  from public.manager_board_entries e
  where e.id = p_id and e.host_id = public.current_host_id();

  if found and p_card_id is not null then
    -- A repeat of a write (a write names its card, a change of words does not): the comment as
    -- it stands, whatever was done to it since.
    return v_entry;
  end if;

  if not found then
    if p_card_id is null then
      raise exception 'Comment % not found', p_id
        using errcode = 'no_data_found', hint = 'serverErrors.boardCommentNotYours';
    end if;
    v_card := public.manager_card_for_edit(p_card_id, false);
    insert into public.manager_board_entries (id, host_id, card_id, kind, body, author_id)
    values (p_id, v_card.host_id, v_card.id, 'comment', v_body, (select auth.uid()))
    on conflict (id) do nothing
    returning * into v_entry;
    if v_entry.id is null then
      -- Written meanwhile by a repeat (or another company's id): the comment as it stands.
      select e.* into v_entry
      from public.manager_board_entries e
      where e.id = p_id and e.host_id = v_card.host_id;
      if not found then
        raise exception 'Comment % not found', p_id
          using errcode = 'no_data_found', hint = 'serverErrors.boardCommentNotYours';
      end if;
    end if;
    return v_entry;
  end if;

  v_card := public.manager_card_for_edit(v_entry.card_id, false);
  if v_entry.kind <> 'comment' or v_entry.author_id is distinct from (select auth.uid()) then
    raise exception 'Only its author changes comment %', p_id
      using errcode = 'insufficient_privilege', hint = 'serverErrors.boardCommentNotYours';
  end if;

  select e.* into v_entry from public.manager_board_entries e where e.id = p_id for update;
  if v_entry.body is distinct from v_body then
    update public.manager_board_entries e
    set body = v_body, edited_at = now()
    where e.id = v_entry.id
    returning e.* into v_entry;
  end if;
  return v_entry;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_manager_step(p_id uuid, p_card_id uuid, p_body text)
 RETURNS manager_board_steps
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_body text := btrim(coalesce(p_body, ''), E' \t\r\n');
  v_card public.manager_board_cards;
  v_step public.manager_board_steps;
begin
  if not public.is_full_manager() then
    raise exception 'Only a manager may do this'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;
  if p_id is null then
    raise exception 'A step needs an id' using errcode = 'invalid_parameter_value', hint = 'serverErrors.unknown';
  end if;
  if char_length(v_body) not between 1 and 500 then
    raise exception 'A step needs words, up to 500 characters'
      using errcode = 'check_violation', hint = 'serverErrors.boardStepInvalid',
            detail = jsonb_build_object('max', 500)::text;
  end if;

  if exists (select 1 from public.manager_board_steps s where s.id = p_id) then
    if p_card_id is not null then
      -- A repeat of an add (an add names its card, a change of words does not): the step as it
      -- stands, whatever was done to it since, if it is the caller's company's.
      select s.* into v_step
      from public.manager_board_steps s
      where s.id = p_id and s.host_id = public.current_host_id();
      if not found then
        raise exception 'Step % not found', p_id
          using errcode = 'no_data_found', hint = 'serverErrors.boardStepNotFound';
      end if;
      return v_step;
    end if;
    v_card := public.manager_step_card(p_id);
  else
    if p_card_id is null then
      raise exception 'Step % not found', p_id
        using errcode = 'no_data_found', hint = 'serverErrors.boardStepNotFound';
    end if;
    v_card := public.manager_card_for_edit(p_card_id, false);
    if (select count(*) from public.manager_board_steps s where s.card_id = v_card.id) >= 100 then
      raise exception 'A card holds up to 100 steps'
        using errcode = 'check_violation', hint = 'serverErrors.boardTooManySteps',
              detail = jsonb_build_object('max', 100)::text;
    end if;
    insert into public.manager_board_steps (id, host_id, card_id, body, sort_order, created_by)
    values (p_id, v_card.host_id, v_card.id, v_body,
            coalesce((select max(s.sort_order) from public.manager_board_steps s
                      where s.card_id = v_card.id), 0) + 1,
            (select auth.uid()))
    on conflict (id) do nothing
    returning * into v_step;
    if v_step.id is null then
      -- Added meanwhile by a repeat: that step, as it stands.
      select s.* into v_step
      from public.manager_board_steps s
      where s.id = p_id and s.host_id = v_card.host_id;
      if not found then
        raise exception 'Step % not found', p_id
          using errcode = 'no_data_found', hint = 'serverErrors.boardStepNotFound';
      end if;
    end if;
    return v_step;
  end if;

  select s.* into v_step
  from public.manager_board_steps s
  where s.id = p_id and s.card_id = v_card.id
  for update;
  if not found then
    raise exception 'Step % not found', p_id
      using errcode = 'no_data_found', hint = 'serverErrors.boardStepNotFound';
  end if;

  if v_step.body is distinct from v_body then
    update public.manager_board_steps s
    set body = v_body, updated_at = now()
    where s.id = v_step.id
    returning s.* into v_step;
  end if;
  return v_step;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_manager_comment(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_entry public.manager_board_entries;
begin
  if not public.is_full_manager() then
    raise exception 'Only a manager may do this'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;

  select e.* into v_entry
  from public.manager_board_entries e
  where e.id = p_id and e.host_id = public.current_host_id();
  if not found then
    return;
  end if;

  perform public.manager_card_for_edit(v_entry.card_id, false);
  if v_entry.kind <> 'comment'
     or (v_entry.author_id is distinct from (select auth.uid())
         and public.auth_role() is distinct from 'admin') then
    raise exception 'Only its author or an admin deletes comment %', p_id
      using errcode = 'insufficient_privilege', hint = 'serverErrors.boardCommentNotYours';
  end if;

  delete from public.manager_board_entries e where e.id = p_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_manager_step(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_full_manager() then
    raise exception 'Only a manager may do this'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;
  if not exists (select 1 from public.manager_board_steps s where s.id = p_id) then
    return;
  end if;
  perform public.manager_step_card(p_id);
  delete from public.manager_board_steps s where s.id = p_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_manager_board_archived(p_id uuid, p_archived boolean)
 RETURNS manager_boards
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_board public.manager_boards;
begin
  if not public.is_full_manager() then
    raise exception 'Only a manager may do this'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;
  -- Taken for update before the rights' share: two archives of one board queue (see above).
  perform 1 from public.manager_boards b
  where b.id = p_id and b.host_id = public.current_host_id()
  for update;
  v_board := public.manager_board_for_edit(p_id, true);
  if coalesce(p_archived, false) = (v_board.archived_at is not null) then
    return v_board;
  end if;

  update public.manager_boards b
  set archived_at = case when p_archived then now() end,
      archived_by = case when p_archived then (select auth.uid()) end,
      updated_at  = now()
  where b.id = p_id
  returning b.* into v_board;
  return v_board;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_signal_settings(p_sync_enabled boolean DEFAULT NULL::boolean, p_texts_enabled boolean DEFAULT NULL::boolean, p_tasks_enabled boolean DEFAULT NULL::boolean, p_model_enabled boolean DEFAULT NULL::boolean, p_auto_kinds text[] DEFAULT NULL::text[], p_daily_model_cap integer DEFAULT NULL::integer, p_min_confidence numeric DEFAULT NULL::numeric, p_notice_published_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_daily_auto_cap integer DEFAULT NULL::integer, p_kind guest_signal_kind DEFAULT NULL::guest_signal_kind)
 RETURNS signal_settings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_host       uuid := public.current_host_id();
  v_signal     public.guest_signal_kind := coalesce(p_kind, 'review');
  v_row        public.signal_settings;
  v_kind       text;
  v_record     record;
  v_model      boolean;
  v_old_day    date;
  v_new_day    date;
  v_line_moves boolean;
  v_is_admin   boolean := public.auth_role() = 'admin' and public.is_active_user();
begin
  if not public.is_full_manager() then
    raise exception 'Only a manager changes guest signal settings'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.forbidden';
  end if;

  insert into public.signal_settings (host_id, kind) values (v_host, v_signal) on conflict do nothing;
  select * into v_row from public.signal_settings
  where host_id = v_host and kind = v_signal
  for update;

  -- The gates and the money are the admin's: the ceiling on model calls and
  -- the confidence floor decide what is paid for and what reaches people;
  -- auto decides what reaches a technician with nobody looking.
  if not v_is_admin and (p_texts_enabled is not null or p_model_enabled is not null
                         or p_tasks_enabled is not null or p_notice_published_at is not null
                         or p_daily_model_cap is not null or p_min_confidence is not null
                         or p_daily_auto_cap is not null
                         or (p_auto_kinds is not null and not (p_auto_kinds <@ v_row.auto_kinds))) then
    raise exception 'Only an admin switches the guest signal gates'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.signalGateAdminOnly';
  end if;

  -- The notice's date is set once, never ahead of now: moving it earlier would
  -- widen the stays whose texts are kept.
  if p_notice_published_at is not null then
    if p_notice_published_at > now()
       or (v_row.notice_published_at is not null
           and p_notice_published_at <> v_row.notice_published_at) then
      raise exception 'The notice date is set once and not in the future'
        using errcode = 'check_violation', hint = 'serverErrors.signalNoticeDateFixed';
    end if;
  end if;
  -- Messages keep their gate (the owner's decision of 2026-11-02 frees the
  -- reviews' texts only): their texts need the notice, and the model reads
  -- messages only after the data protection lawyer's opinion.
  if v_signal <> 'review' and coalesce(p_texts_enabled, v_row.texts_enabled)
     and coalesce(p_notice_published_at, v_row.notice_published_at) is null then
    raise exception 'Texts of messages need the published guest notice'
      using errcode = 'check_violation', hint = 'serverErrors.signalTextsNeedNotice';
  end if;
  -- The notice's first date, on another day than the texts' first day, takes
  -- the line over.
  v_old_day := (v_row.texts_enabled_at at time zone 'Europe/Prague')::date;
  v_new_day := (p_notice_published_at at time zone 'Europe/Prague')::date;
  v_line_moves := coalesce(v_row.notice_published_at is null and v_new_day <> v_old_day, false);
  -- Texts off with nothing said about the model: the model goes off too, it
  -- would have nothing to read.
  v_model := case when p_texts_enabled is false and p_model_enabled is null then false
                  else coalesce(p_model_enabled, v_row.model_enabled) end;
  if v_model and not coalesce(p_texts_enabled, v_row.texts_enabled) then
    raise exception 'The model needs the texts switched on'
      using errcode = 'check_violation', hint = 'serverErrors.signalModelNeedsTexts';
  end if;

  if p_auto_kinds is not null then
    foreach v_kind in array p_auto_kinds loop
      if not (v_kind = any (array['repair', 'safety', 'pests', 'access'])) then
        raise exception 'Kind % never makes a problem', v_kind
          using errcode = 'check_violation', hint = 'serverErrors.signalKindNoTask',
                detail = jsonb_build_object('kind', v_kind)::text;
      end if;
      if not (v_kind = any (v_row.auto_kinds)) then
        select * into v_record
        from public.signal_finding_record(v_host, v_signal, v_kind::public.signal_finding_kind);
        if v_record.decisions < 50 or v_record.approved * 10 < v_record.decisions * 9 then
          raise exception 'Kind % has not earned auto yet', v_kind
            using errcode = 'check_violation', hint = 'serverErrors.signalAutoNotEarned',
                  detail = jsonb_build_object('kind', v_kind, 'decisions', v_record.decisions,
                                              'approved', v_record.approved)::text;
        end if;
      end if;
    end loop;
  end if;

  update public.signal_settings
  set sync_enabled        = coalesce(p_sync_enabled, sync_enabled),
      texts_enabled       = coalesce(p_texts_enabled, texts_enabled),
      -- The first time texts go on their line is drawn: now, never ahead of
      -- it, and never moved after (texts off and on again keep it).
      texts_enabled_at    = case when p_texts_enabled and v_signal = 'review' and texts_enabled_at is null
                                 then now() else texts_enabled_at end,
      tasks_enabled       = coalesce(p_tasks_enabled, tasks_enabled),
      model_enabled       = v_model,
      -- Each time the model goes on it reads back 14 days and no further (the
      -- owner's decision of 2026-10-18 for the first time; the same for a
      -- later one, so a month off never comes back as a month of cards).
      model_since         = case when v_model and not v_row.model_enabled
                                 then now() - interval '14 days' else model_since end,
      auto_kinds          = coalesce(p_auto_kinds, auto_kinds),
      daily_model_cap     = coalesce(p_daily_model_cap, daily_model_cap),
      daily_auto_cap      = coalesce(p_daily_auto_cap, daily_auto_cap),
      min_confidence      = coalesce(p_min_confidence, min_confidence),
      notice_published_at = coalesce(p_notice_published_at, notice_published_at),
      updated_by          = (select auth.uid())
  where host_id = v_host and kind = v_signal
  returning * into v_row;

  -- The line moved to the notice's day. A stay cut to its month kept only
  -- which side of the old line it began on: moved later, a stay after the old
  -- line may be before the new one; moved earlier, a stay before the old line
  -- may be after the new one. Those answers go, and their month answers alone
  -- (review_text_allowed) — never later than the real day. Moved later, every
  -- text the new line no longer allows goes at once, with what was drawn from
  -- it: the history before the line keeps its ratings only.
  if v_line_moves then
    update public.guest_signals g
    set stay_after_notice = null
    where g.host_id = v_host and g.kind = v_signal
      and not g.stay_exact and g.stay_after_notice = (v_new_day > v_old_day);
    if v_new_day > v_old_day then
      perform public.erase_signal_texts(array(
        select g.id from public.guest_signals g
        where g.host_id = v_host and g.kind = v_signal
          and (g.public_text is not null or g.private_text is not null or g.category_comments is not null)
          and not public.review_text_allowed(g, v_row)));
    end if;
  end if;

  -- Texts off: what was kept goes now, not in 18 months. A load running at
  -- this moment stores nothing more (store_review_texts reads the switch);
  -- the nightly purge sweeps whatever raced it.
  if p_texts_enabled is false then
    perform public.erase_signal_texts(array(
      select g.id from public.guest_signals g where g.host_id = v_host and g.kind = v_signal));
  end if;

  -- A review that waited only for a reader this call took away (texts or
  -- the model off) is settled now: its stay goes to its month at once, not
  -- at the nightly sweep.
  perform public.cut_signal_stay_links(array(
    select g.id from public.guest_signals g
    where g.host_id = v_host and g.kind = v_signal and g.stay_exact));

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.guard_profile_privileges()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  new.email := old.email;
  new.host_id := old.host_id;

  if not public.is_full_manager() then
    new.role := old.role;
    new.is_active := old.is_active;
  end if;

  return new;
end;
$function$;

-- ---------- the office: the reception beside the manager and the admin ----------

CREATE OR REPLACE FUNCTION public.chat_participates(p_kind chat_thread_kind, p_task_id uuid, p_problem_id uuid, p_profile_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- The caller is read ONCE. A policy calls this, so it runs per row of
  -- chat_threads; the first draft asked is_active_user(), current_host_id() and
  -- is_manager() separately, and each is its own definer call into profiles.
  -- Measured on 1500 threads that was 0.8 ms a row for a manager and 3.9 ms for
  -- a cleaner: a list whose cost grows with the company rather than with what
  -- the reader can actually see.
  with me as (
    select p.id, p.host_id, (p.role in ('manager', 'admin', 'reception')) as is_manager,
           (p.role = 'head_tech') as is_head_tech
    from public.profiles p
    where p.id = (select auth.uid()) and p.is_active
  )
  select coalesce((
    select case p_kind
      when 'task' then exists (
        select 1 from public.tasks t
        where t.id = p_task_id
          and t.host_id = me.host_id
          and (me.is_manager
               or (not public.task_is_beyond_horizon(t.property_id, t.scheduled_date)
                   and (t.assignee_id = me.id
                        or public.cleans_property(t.property_id)))))
      when 'problem' then exists (
        select 1 from public.problems pb
        where pb.id = p_problem_id
          and pb.host_id = me.host_id
          and (me.is_manager
               -- The head technician takes part in the conversation of every
               -- task of his company, archived ones too (decisions 5 and 7 of
               -- 2026-10-01, 20261003120000).
               or me.is_head_tech
               or (pb.archived_at is null
                   and (pb.reported_by = me.id
                        -- The horizon belongs here too, and it is the one place
                        -- being a definer changes the answer. The policy this arm
                        -- reproduces, "fixer reads problems of own tasks", is a
                        -- POLICY expression: its exists() on tasks is row
                        -- filtered as the caller, and the task policies hide a
                        -- repair scheduled past the horizon even from its own
                        -- assignee. Here the same exists() runs as the owner and
                        -- would see it -- leaving a conversation readable whose
                        -- subject is not.
                        or exists (select 1 from public.tasks t
                                   where t.problem_id = pb.id
                                     and t.assignee_id = me.id
                                     -- A cancelled attempt takes the
                                     -- conversation with it (20260918110000).
                                     -- 'done' stays in: whoever finished the
                                     -- repair is still the person to ask.
                                     and t.status not in ('cancelled', 'expired')
                                     and not public.task_is_beyond_horizon(
                                           t.property_id, t.scheduled_date))))))
      when 'direct' then
        exists (select 1 from public.profiles pr
                where pr.id = p_profile_id
                  and pr.host_id = me.host_id
                  -- Field staff only. The company inbox is the office talking to
                  -- whoever goes to the flat; a thread whose subject is a manager
                  -- would be read by every other manager of the host, which is a
                  -- group chat and not an inbox. Manager to manager is out of
                  -- scope (docs/chat-plan.md).
                  and pr.role in ('cleaner', 'tech', 'head_tech'))
        -- `pr.is_active` is deliberately NOT tested. Dismissing somebody must not
        -- delete the company's own record of what was said to her: the office
        -- keeps the inbox, and she loses it through `me` above, which requires
        -- the CALLER to be active.
        and (p_profile_id = me.id or me.is_manager)
    end
    from me
  ), false)
  -- coalesce, not a bare case. An unknown kind, or no active profile for the
  -- caller, must answer NO -- and `if not <null>` does not fire, so a null would
  -- walk straight through the gates in open_thread and mark_thread_read.
$function$;

CREATE OR REPLACE FUNCTION public.chat_participates_as(p_person_id uuid, p_kind chat_thread_kind, p_task_id uuid, p_problem_id uuid, p_profile_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- The person is read ONCE, as in chat_participates, whose body this is
  -- with the person as a parameter instead of auth.uid().
  with me as (
    select p.id, p.host_id, (p.role in ('manager', 'admin', 'reception')) as is_manager,
           (p.role = 'head_tech') as is_head_tech
    from public.profiles p
    where p.id = p_person_id and p.is_active
  )
  select coalesce((
    select case p_kind
      when 'task' then exists (
        select 1 from public.tasks t
        where t.id = p_task_id
          and t.host_id = me.host_id
          and (me.is_manager
               or (not public.task_is_beyond_horizon(t.property_id, t.scheduled_date)
                   and (t.assignee_id = me.id
                        or public.cleans_property_as(me.id, t.property_id)))))
      when 'problem' then exists (
        select 1 from public.problems pb
        where pb.id = p_problem_id
          and pb.host_id = me.host_id
          and (me.is_manager
               -- The head technician takes part in the conversation of every
               -- task of his company, archived ones too (decisions 5 and 7 of
               -- 2026-10-01, 20261003120000).
               or me.is_head_tech
               or (pb.archived_at is null
                   and (pb.reported_by = me.id
                        -- The horizon belongs here too, and it is the one place
                        -- being a definer changes the answer. The policy this arm
                        -- reproduces, "fixer reads problems of own tasks", is a
                        -- POLICY expression: its exists() on tasks is row
                        -- filtered as the caller, and the task policies hide a
                        -- repair scheduled past the horizon even from its own
                        -- assignee. Here the same exists() runs as the owner and
                        -- would see it -- leaving a conversation readable whose
                        -- subject is not.
                        or exists (select 1 from public.tasks t
                                   where t.problem_id = pb.id
                                     and t.assignee_id = me.id
                                     -- A cancelled attempt takes the
                                     -- conversation with it (20260918110000).
                                     -- 'done' stays in: whoever finished the
                                     -- repair is still the person to ask.
                                     and t.status not in ('cancelled', 'expired')
                                     and not public.task_is_beyond_horizon(
                                           t.property_id, t.scheduled_date))))))
      when 'direct' then
        exists (select 1 from public.profiles pr
                where pr.id = p_profile_id
                  and pr.host_id = me.host_id
                  -- Field staff only. The company inbox is the office talking to
                  -- whoever goes to the flat; a thread whose subject is a manager
                  -- would be read by every other manager of the host, which is a
                  -- group chat and not an inbox. Manager to manager is out of
                  -- scope (docs/chat-plan.md).
                  and pr.role in ('cleaner', 'tech', 'head_tech'))
        -- `pr.is_active` is deliberately NOT tested. Dismissing somebody must not
        -- delete the company's own record of what was said to her: the office
        -- keeps the inbox, and she loses it through `me` above, which requires
        -- the CALLER to be active.
        and (p_profile_id = me.id or me.is_manager)
    end
    from me
  ), false)
  -- coalesce, not a bare case. An unknown kind, or no active profile for the
  -- caller, must answer NO -- and `if not <null>` does not fire, so a null would
  -- walk straight through the gates in open_thread and mark_thread_read.
$function$;

CREATE OR REPLACE FUNCTION public.chat_unread_threads(p_task_ids uuid[] DEFAULT NULL::uuid[], p_problem_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(thread_id uuid, kind chat_thread_kind, task_id uuid, problem_id uuid, profile_id uuid, last_message_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- `not materialized`: `me` is referenced three times, and a materialized
  -- CTE would turn the marker join into a hash over ALL of chat_reads instead
  -- of an index probe by the caller (seen in the layer 4 preflight).
  with me as not materialized (
    select p.id, p.host_id, (p.role in ('manager', 'admin', 'reception')) as is_manager,
           (p.role = 'head_tech') as is_head_tech
    from public.profiles p
    where p.id = (select auth.uid()) and p.is_active
  ),
  -- Two branches, not one `or`. A definer SQL function cannot be inlined, so
  -- its body is planned once with the arrays as unknown parameters, and an
  -- `or` whose first disjunct mentions no column is not indexable: the phone's
  -- call with 60 ids walked every thread of every tenant (51 500 rows removed
  -- by filter in the preflight). Split on the parameter-only test, each branch
  -- gets a one-time filter and the ids branch a BitmapOr over the two partial
  -- indexes. No ids at all means the whole company; an empty array means
  -- nothing (`= any(null)` is as false as `= any('{}')`).
  candidates as (
    select th.*
    from me
    join public.chat_threads th on th.host_id = me.host_id
    where p_task_ids is null and p_problem_ids is null
    union all
    select th.*
    from me
    join public.chat_threads th on th.host_id = me.host_id
    where (p_task_ids is not null or p_problem_ids is not null)
      and (th.task_id = any (p_task_ids) or th.problem_id = any (p_problem_ids))
  )
  select th.id, th.kind, th.task_id, th.problem_id, th.profile_id, th.last_message_at
  from me
  join candidates th on true
  left join public.chat_reads r on r.thread_id = th.id and r.profile_id = me.id
  where th.last_message_at > coalesce(r.last_read_at, '-infinity')
    and th.last_author_id is distinct from me.id
    -- `case`, not `or`: SQL does not promise to short-circuit, and the whole
    -- point is that a manager never pays for the field-staff branch. Only
    -- work threads take the short cut: for those the manager branch of
    -- chat_participates is exactly "same host", which the join above already
    -- is. A direct thread is not -- its subject must still be field staff,
    -- so somebody promoted out of the field takes her inbox out of everyone's
    -- reach, and the rule is asked, not assumed.
    and case
          when me.is_manager and th.kind <> 'direct' then true
          -- The head technician takes part in the conversation of every task
          -- of his company (20261003120000): for a task's thread his branch of
          -- chat_participates is "same company", which the join already is. A
          -- cleaning's thread and the inbox are asked (20261003160000).
          when me.is_head_tech and th.kind = 'problem' then true
          else public.chat_participates(th.kind, th.task_id, th.problem_id, th.profile_id)
        end
  order by th.last_message_at desc
$function$;

CREATE OR REPLACE FUNCTION public.push_on_task_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor  uuid := (select auth.uid());
  -- The office: a manager, or the head technician dispatching a repair through
  -- assign_problem or unassign_problem (20261003130000). His move reads as
  -- the office's, not as a booking's (20261003160000).
  v_office boolean := v_actor is not null
                      and (coalesce(public.is_manager(), false) or public.head_tech_dispatching());
  -- unassign_problem cancels the attempt under the dispatch setting, and
  -- nothing else cancels under it: for the technician the work is taken from
  -- him, not cancelled (20261003160000).
  v_taken_off boolean := coalesce(current_setting('str_ops.head_tech_dispatch', true), '') = 'on';
  -- Asked once a statement, not once a row: a SQL function with its own
  -- search_path is never inlined, and a dozen such calls a row cost 0.3-0.5 ms
  -- a row with an event (measured 2026-09-28, 660 rows, rolled back).
  v_grace      integer := public.task_grace_days();
  v_horizon    integer := public.task_horizon_days();
  v_lifetime   interval := public.push_lifetime();
  v_now_after  timestamptz := public.push_send_after(true);
  v_calm_after timestamptz := public.push_send_after(false);
begin
  -- Everything below is about people with a phone. Without one registered in
  -- the company the statement has nobody to tell: the common case until the
  -- first phone arrives, and the whole cost of this trigger then.
  if not exists (select 1 from public.push_tokens) then
    return null;
  end if;

  if tg_op = 'INSERT' then
    with ev as materialized (
      -- A new row with a name on it: new work from the generator, an
      -- assignment from the office.
      select n.host_id, n.assignee_id as recipient_id,
             (case when v_actor is null then 'cleaning_new' else 'cleaning_assigned' end)::public.push_kind as kind,
             n.id as task_id, n.property_id,
             n.scheduled_date as day_a, n.scheduled_date as day_b,
             jsonb_build_object('date', n.scheduled_date, 'type', n.type,
                                'property', n.property_id) as params
      from new_rows n
      where n.assignee_id is not null
        and n.status in ('assigned', 'accepted')
    ),
    free as materialized (
      -- Only what a cleaner may take from the queue (apps/mobile tasks/api.ts,
      -- FREE_TASK_TYPES): an inspection or maintenance is the office's.
      select n.host_id, n.id as task_id, n.property_id, n.scheduled_date, n.type
      from new_rows n
      where n.assignee_id is null
        and n.status = 'unassigned'
        and n.type in ('cleaning', 'midstay')
    )
    insert into raw.push_outbox (host_id, recipient_id, kind, task_id, collapse_key,
                                 params, urgent, send_after, expire_at)
    select e.host_id, e.recipient_id, e.kind, e.task_id, 'task:' || e.task_id,
           e.params, w.urgent,
           case when w.urgent then v_now_after else v_calm_after end,
           case when w.urgent then v_now_after else v_calm_after end + v_lifetime
    from (
      select * from ev
      union all
      -- Free work: everyone who may take it. The listing rule is the twin of
      -- the one in the policies, asked only after the week and the phones have
      -- cut the candidates down — and only of phones linked to the listing, or
      -- to the listing a room belongs to (owner's word 2026-09-29): nobody
      -- else may take it, and asking every phone of the company cost a call a
      -- phone a cleaning. A narrowing, not a second rule: the rule decides.
      select f.host_id, tk.profile_id, 'cleaning_free'::public.push_kind, f.task_id, f.property_id,
             f.scheduled_date, f.scheduled_date,
             jsonb_build_object('date', f.scheduled_date, 'type', f.type, 'property', f.property_id)
      from free f
      join public.properties p on p.id = f.property_id
      -- The candidates come from the listing's own people: a lateral join, so
      -- the rule below is asked of them alone. As a qual beside the rule the
      -- narrowing would be ordered by cost, and the rule, cheaper on paper
      -- than a subquery, went first for every phone.
      join lateral (
        select distinct pc.cleaner_id as profile_id
        from public.property_cleaners pc
        where pc.property_id in (f.property_id, p.parent_id)
          and exists (select 1 from public.push_tokens t where t.profile_id = pc.cleaner_id)
      ) tk on true
      join public.profiles pr on pr.id = tk.profile_id and pr.host_id = f.host_id
      where f.scheduled_date between (now() at time zone p.timezone)::date - v_grace
                                 and (now() at time zone p.timezone)::date + v_horizon
        and public.cleans_property_as(tk.profile_id, f.property_id)
    ) e
    join public.properties p on p.id = e.property_id
    join public.profiles pr on pr.id = e.recipient_id and pr.is_active
    cross join lateral (
      select (now() at time zone p.timezone)::date as today
    ) d
    cross join lateral (
      -- Urgent is what changes her day: taken off her, cancelled or moved,
      -- today or tomorrow (§1.4). New, handed-over and free work can wait out
      -- quiet hours: it goes at seven, before the day starts.
      select (e.kind in ('cleaning_cancelled', 'cleaning_moved', 'cleaning_unassigned')
              and (e.day_a in (d.today, d.today + 1) or e.day_b in (d.today, d.today + 1))) as urgent
    ) w
    where e.recipient_id is distinct from v_actor
      and (e.day_a between d.today - v_grace and d.today + v_horizon
           or e.day_b between d.today - v_grace and d.today + v_horizon)
      and exists (select 1 from public.push_tokens t where t.profile_id = e.recipient_id)
    order by e.task_id, e.recipient_id, e.kind;

    return null;
  end if;

  -- UPDATE
  with pair as materialized (
    select o.id, n.host_id, n.property_id, n.type,
           o.status as old_status, n.status as new_status,
           o.assignee_id as old_assignee, n.assignee_id as new_assignee,
           o.scheduled_date as old_day, n.scheduled_date as new_day,
           o.property_id as old_property,
           o.time_from as old_from, n.time_from as new_from,
           o.time_to as old_to, n.time_to as new_to,
           o.released_at as old_released, n.released_at as new_released,
           n.release_kind
    from old_rows o
    join new_rows n on n.id = o.id
    where o.status is distinct from n.status
       or o.assignee_id is distinct from n.assignee_id
       or o.scheduled_date is distinct from n.scheduled_date
       or o.property_id is distinct from n.property_id
       or o.time_from is distinct from n.time_from
       or o.time_to is distinct from n.time_to
  ),
  ev as (
    -- Handed to her — work already under way or paused included: she now
    -- holds what somebody else started.
    select x.host_id, x.new_assignee as recipient_id, 'cleaning_assigned'::public.push_kind as kind,
           x.id as task_id, x.property_id, x.new_day as day_a, x.new_day as day_b,
           jsonb_build_object('date', x.new_day, 'type', x.type, 'property', x.property_id) as params
    from pair x
    where x.new_assignee is not null
      -- ...or given back to her: the office returned a cancelled cleaning (20261118120000).
      and (x.new_assignee is distinct from x.old_assignee or x.old_status = 'cancelled')
      and x.new_status in ('assigned', 'accepted', 'in_progress', 'paused', 'blocked')
    union all
    -- Taken from her, and not by being cancelled or closed.
    select x.host_id, x.old_assignee, 'cleaning_unassigned', x.id, x.property_id,
           x.old_day, x.old_day,
           jsonb_build_object('date', x.old_day, 'type', x.type, 'property', x.old_property)
    from pair x
    where x.old_assignee is not null
      and x.new_assignee is distinct from x.old_assignee
      and x.old_status not in ('done', 'cancelled', 'expired')
      and x.new_status not in ('done', 'cancelled', 'expired')
    union all
    -- Cancelled while open, work under way included. Taken off through
    -- unassign_problem, it is taken from her rather than cancelled.
    select x.host_id, x.old_assignee,
           (case when v_taken_off then 'cleaning_unassigned'
                 else 'cleaning_cancelled' end)::public.push_kind,
           x.id, x.property_id,
           x.old_day, x.old_day,
           jsonb_build_object('date', x.old_day, 'type', x.type, 'property', x.old_property)
    from pair x
    where x.new_status = 'cancelled'
      and x.old_status not in ('done', 'cancelled', 'expired')
      and x.old_assignee is not null
    union all
    -- Moved to another day or room while hers and not started.
    select x.host_id, x.new_assignee, 'cleaning_moved', x.id, x.property_id,
           x.old_day, x.new_day,
           jsonb_build_object('from_date', x.old_day, 'to_date', x.new_day,
                              'from_property', x.old_property, 'to_property', x.property_id,
                              'property', x.property_id, 'type', x.type,
                              'by', case when v_office then 'office' else 'booking' end)
    from pair x
    where x.new_assignee is not null
      and x.new_assignee = x.old_assignee
      and x.old_status in ('assigned', 'accepted')
      and x.new_status in ('assigned', 'accepted')
      and (x.new_day is distinct from x.old_day or x.property_id is distinct from x.old_property)
    union all
    -- The hours changed on the same day and room. Only today's and
    -- tomorrow's: the filter below keeps those.
    select x.host_id, x.new_assignee, 'cleaning_window', x.id, x.property_id,
           x.new_day, x.new_day,
           jsonb_build_object('date', x.new_day, 'time_from', x.new_from, 'time_to', x.new_to,
                              'type', x.type, 'property', x.property_id)
    from pair x
    where x.new_assignee is not null
      and x.new_assignee = x.old_assignee
      and x.old_status in ('assigned', 'accepted')
      and x.new_status in ('assigned', 'accepted')
      and x.new_day = x.old_day
      and x.property_id = x.old_property
      and (x.new_from is distinct from x.old_from or x.new_to is distinct from x.old_to)
    union all
    -- A cleaner handed her cleaning back (20261118120000): declined it before
    -- starting, or interrupted it. Every manager and admin of the company hears
    -- who and which cleaning; her own words wait in the panel.
    select x.host_id, m.id,
           (case x.release_kind when 'declined' then 'cleaning_declined'
                                else 'cleaning_interrupted' end)::public.push_kind,
           x.id, x.property_id, x.new_day, x.new_day,
           jsonb_build_object('date', x.new_day, 'type', x.type, 'property', x.property_id,
                              'by', x.old_assignee, 'by_name', who.full_name)
    from pair x
    join public.profiles m
      on m.host_id = x.host_id and m.role in ('manager', 'admin', 'reception') and m.is_active
    left join public.profiles who on who.id = x.old_assignee
    where x.release_kind is not null
      and x.new_released is distinct from x.old_released
  ),
  free as materialized (
    -- Free work newly in reach: it became free, or free work moved (the
    -- audience below keeps a move only when it came into the week). Only what
    -- a cleaner may take from the queue, as on INSERT.
    select x.host_id, x.id as task_id, x.property_id, x.new_day, x.old_day, x.type, x.old_assignee,
           (x.old_status is distinct from 'unassigned' or x.old_assignee is not null) as became_free
    from pair x
    where x.new_status = 'unassigned'
      and x.new_assignee is null
      and x.type in ('cleaning', 'midstay')
      and (x.old_status is distinct from 'unassigned' or x.old_assignee is not null
           or x.old_day is distinct from x.new_day)
  )
  insert into raw.push_outbox (host_id, recipient_id, kind, task_id, collapse_key,
                               params, urgent, send_after, expire_at)
  select e.host_id, e.recipient_id, e.kind, e.task_id, 'task:' || e.task_id,
         e.params, w.urgent,
         case when w.urgent then v_now_after else v_calm_after end,
         case when w.urgent then v_now_after else v_calm_after end + v_lifetime
  from (
    select * from ev
    union all
    select f.host_id, tk.profile_id, 'cleaning_free'::public.push_kind, f.task_id, f.property_id,
           f.new_day, f.new_day,
           jsonb_build_object('date', f.new_day, 'type', f.type, 'property', f.property_id)
    from free f
    join public.properties p on p.id = f.property_id
    -- Only phones linked to the listing or its house, as on INSERT.
    join lateral (
      select distinct pc.cleaner_id as profile_id
      from public.property_cleaners pc
      where pc.property_id in (f.property_id, p.parent_id)
        and exists (select 1 from public.push_tokens t where t.profile_id = pc.cleaner_id)
    ) tk on true
    join public.profiles pr on pr.id = tk.profile_id and pr.host_id = f.host_id
    where f.new_day between (now() at time zone p.timezone)::date - v_grace
                        and (now() at time zone p.timezone)::date + v_horizon
      and (f.became_free
           or f.old_day not between (now() at time zone p.timezone)::date - v_grace
                                and (now() at time zone p.timezone)::date + v_horizon)
      -- Not the one it was just taken from: she hears it was taken off her,
      -- and "free" would read as an offer of her own cleaning back.
      and tk.profile_id is distinct from f.old_assignee
      and public.cleans_property_as(tk.profile_id, f.property_id)
  ) e
  join public.properties p on p.id = e.property_id
  join public.profiles pr on pr.id = e.recipient_id and pr.is_active
  cross join lateral (
    select (now() at time zone p.timezone)::date as today
  ) d
  cross join lateral (
    -- Urgent: taken off her, cancelled or moved, today or tomorrow (as above).
    select (e.kind in ('cleaning_cancelled', 'cleaning_moved', 'cleaning_unassigned',
                       'cleaning_declined', 'cleaning_interrupted')
            and (e.day_a in (d.today, d.today + 1) or e.day_b in (d.today, d.today + 1))) as urgent
  ) w
  where e.recipient_id is distinct from v_actor
    and (e.day_a between d.today - v_grace and d.today + v_horizon
         or e.day_b between d.today - v_grace and d.today + v_horizon)
    -- The hours matter today and tomorrow only.
    and (e.kind <> 'cleaning_window' or e.day_b in (d.today, d.today + 1))
    and exists (select 1 from public.push_tokens t where t.profile_id = e.recipient_id)
  order by e.task_id, e.recipient_id, e.kind;

  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.stamp_problem_closing()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_was    boolean := old.status in ('resolved', 'cancelled') or old.archived_at is not null;
  v_is     boolean := new.status in ('resolved', 'cancelled') or new.archived_at is not null;
  v_actor  uuid := (select auth.uid());
  v_choice jsonb := nullif(current_setting('str_ops.problem_closing', true), '')::jsonb;
  v_role   public.app_role;
  v_worker uuid;
begin
  if not v_is then
    new.completed_by := null;
    new.completed_by_source := null;
    new.closed_by    := null;
    new.closed_how   := null;
    new.closed_cause := null;
    new.closed_at    := null;
    return new;
  end if;
  -- Still closed the same way: a resolved task put in the archive keeps who resolved it.
  if v_was and new.status = old.status then
    return new;
  end if;

  new.closed_at    := now();
  new.closed_cause := null;

  -- A fix closes with its attempt: the mirror resolves the task in the same write, and the
  -- attempt already says who finished it. Only an attempt finished in this transaction: a task
  -- reopened and closed again keeps the attempt of the round before, which did not close it.
  if new.status = 'resolved' then
    select t.completed_by into v_worker
    from public.tasks t
    where t.problem_id = new.id and t.status = 'done' and t.completed_at = now()
    order by t.id desc
    limit 1;
  end if;

  -- resolve_problem with the manager's choice (written for this task, in this transaction).
  if v_choice is not null and v_choice ->> 'problem' = new.id::text then
    new.closed_by    := v_actor;
    new.closed_how   := v_choice ->> 'how';
    new.completed_by := nullif(v_choice ->> 'completed_by', '')::uuid;
    new.completed_by_source := case when new.completed_by is not null then 'manager' end;
    return new;
  end if;

  if v_actor is null then
    new.closed_by    := null;
    new.closed_how   := 'auto';
    new.closed_cause := nullif(current_setting('str_ops.closing_cause', true), '');
    new.completed_by := v_worker;
    new.completed_by_source := case when v_worker is not null then 'recorded' end;
    return new;
  end if;

  select pr.role into v_role from public.profiles pr where pr.id = v_actor;
  new.closed_by := v_actor;
  if v_role in ('manager', 'admin', 'reception') then
    new.closed_how := 'manager';
    -- The guard writes the manager as the finisher when nobody is named: that names nobody.
    new.completed_by := case when v_worker is distinct from v_actor then v_worker end;
  else
    new.closed_how   := 'worker';
    new.completed_by := v_worker;
  end if;
  new.completed_by_source := case when new.completed_by is not null then 'recorded' end;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.stamp_task_closing()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_was    boolean := old.status in ('done', 'cancelled', 'expired');
  v_actor  uuid := (select auth.uid());
  v_choice jsonb := nullif(current_setting('str_ops.task_closing', true), '')::jsonb;
  v_role   public.app_role;
  v_how    text;
  v_by     uuid;
  v_cause  text;
  v_worker uuid;
  v_source text;
begin
  if new.status not in ('done', 'cancelled', 'expired') then
    if v_was then
      delete from public.task_closings c where c.task_id = new.id;
    end if;
    return null;
  end if;

  select pr.role into v_role from public.profiles pr where pr.id = v_actor;

  if v_choice is not null and v_choice ->> 'task' = new.id::text then
    -- complete_cleaning: the manager's word.
    v_how    := v_choice ->> 'how';
    v_by     := v_actor;
    v_worker := nullif(v_choice ->> 'completed_by', '')::uuid;
    v_source := case when v_worker is not null then 'manager' end;
  elsif v_actor is null then
    v_how := 'auto';
    -- The journal's row of this very write says why (its trigger sorts before this one).
    v_cause := case new.status
      when 'expired' then 'night_pass'
      when 'cancelled' then (select e.cause from public.task_events e
                             where e.task_id = new.id and e.kind::text = 'cancelled'
                               and e.at >= now()
                             order by e.id desc limit 1)
    end;
    if new.status = 'done' and new.completed_by is not null then
      v_worker := new.completed_by;
      v_source := 'recorded';
    end if;
  elsif v_role in ('manager', 'admin', 'reception') then
    v_how := 'manager';
    v_by  := v_actor;
    -- The guard writes the manager as the finisher when nobody is named: that names nobody.
    if new.status = 'done' and new.completed_by is distinct from v_actor and new.completed_by is not null then
      v_worker := new.completed_by;
      v_source := 'manager';
    end if;
  else
    v_how := 'worker';
    v_by  := v_actor;
    if new.status = 'done' and new.completed_by is not null then
      v_worker := new.completed_by;
      v_source := 'recorded';
    end if;
  end if;

  insert into public.task_closings as c
    (task_id, host_id, completed_by, worker_source, closed_by, closed_how, closed_cause,
     closer_source, closed_at)
  values (new.id, new.host_id, v_worker, v_source, v_by, v_how, v_cause, 'recorded', now())
  on conflict (task_id) do update
  set completed_by  = excluded.completed_by,
      worker_source = excluded.worker_source,
      closed_by     = excluded.closed_by,
      closed_how    = excluded.closed_how,
      closed_cause  = excluded.closed_cause,
      closer_source = excluded.closer_source,
      closed_at     = excluded.closed_at,
      marked_by     = null,
      marked_at     = null;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.guest_message_target(p_user_id uuid, p_problem_id uuid DEFAULT NULL::uuid, p_finding_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_person  public.profiles;
  v_office  boolean;
  v_finding public.signal_findings;
  v_signal  public.guest_signals;
begin
  select p.* into v_person from public.profiles p where p.id = p_user_id;
  if v_person.id is null or not v_person.is_active or v_person.host_id is null
     or v_person.role::text not in ('manager', 'admin', 'reception', 'head_tech') then
    return jsonb_build_object('status', 'forbidden');
  end if;
  v_office := v_person.role::text in ('manager', 'admin', 'reception');

  if (p_problem_id is null) = (p_finding_id is null) then
    return jsonb_build_object('status', 'not_found');
  end if;
  if p_finding_id is not null and not v_office then
    return jsonb_build_object('status', 'forbidden');
  end if;

  if p_finding_id is not null then
    select f.* into v_finding
    from public.signal_findings f
    where f.id = p_finding_id and f.host_id = v_person.host_id;
  else
    select f.* into v_finding
    from public.problems pr
    join public.signal_findings f on f.problem_id = pr.id and f.status = 'task_created'
    where pr.id = p_problem_id and pr.host_id = v_person.host_id and pr.source = 'message';
  end if;
  if v_finding.id is not null then
    select g.* into v_signal
    from public.guest_signals g
    where g.id = v_finding.signal_id and g.host_id = v_finding.host_id and g.kind = 'message';
  end if;
  if v_signal.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_finding.external_conversation_id is null
     or v_finding.conversation_link_ends <= current_date
     or (v_signal.external_id is null and v_signal.external_key like 'purged:%') then
    return jsonb_build_object('status', 'expired');
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'provider', v_signal.provider,
    'conversation_id', v_finding.external_conversation_id,
    'message_id', v_signal.external_id,
    'message_key', case when v_signal.external_key like 'purged:%' then null else v_signal.external_key end);
end;
$function$;

CREATE OR REPLACE FUNCTION public.journal_task_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor    uuid := (select auth.uid());
  -- A cause a server function named for this transaction.
  v_named    text := nullif(current_setting('str_ops.task_cause', true), '');
  -- What the writer's role says, when the change itself says nothing more.
  v_by_actor text;
  v_person   boolean;
  v_moved    boolean;
  v_kind     public.task_event_kind;
  v_params   jsonb;
  v_cause    text;
begin
  -- A name the journal does not know is ignored: the write it describes must
  -- not fail on the check of task_events.cause.
  if v_named not in ('manager', 'head_tech', 'staff', 'staff_inactive', 'booking_cancelled',
                     'property_unavailable', 'booking_changed', 'system',
                     'declined', 'interrupted') then
    v_named := null;
  end if;

  if v_actor is not null then
    select case p.role
             when 'manager' then 'manager'
             when 'admin' then 'manager'
             when 'reception' then 'manager'
             when 'head_tech' then 'head_tech'
             else 'staff'
           end
      into v_by_actor
    from public.profiles p
    where p.id = v_actor;
  end if;

  if tg_op = 'INSERT' then
    insert into public.task_events (host_id, task_id, kind, actor_id, params)
    values (new.host_id, new.id, 'created', v_actor,
            jsonb_build_object(
              'source', case when new.reservation_id is null then 'manual' else 'booking' end,
              'date', new.scheduled_date,
              'status', new.status));
    if new.assignee_id is not null then
      insert into public.task_events (host_id, task_id, kind, actor_id, params)
      values (new.host_id, new.id, 'assigned', v_actor,
              jsonb_build_object('to', new.assignee_id));
    end if;
    return null;
  end if;

  v_person := new.assignee_id is distinct from old.assignee_id;
  v_moved  := new.scheduled_date is distinct from old.scheduled_date
              or new.property_id is distinct from old.property_id;

  -- The person.
  if v_person then
    if old.assignee_id is null then
      v_kind := 'assigned';
      v_params := jsonb_build_object('to', new.assignee_id);
      v_cause := null;
    elsif new.assignee_id is null then
      v_kind := 'unassigned';
      v_params := jsonb_build_object('from', old.assignee_id);
      v_cause := coalesce(
        v_named,
        case when exists (select 1 from public.profiles p
                          where p.id = old.assignee_id and not p.is_active)
             then 'staff_inactive' end,
        v_by_actor,
        'system');
    else
      v_kind := 'reassigned';
      v_params := jsonb_build_object('from', old.assignee_id, 'to', new.assignee_id);
      v_cause := null;
    end if;
    insert into public.task_events (host_id, task_id, kind, actor_id, cause, params)
    values (new.host_id, new.id, v_kind, v_actor, v_cause, v_params);
  end if;

  -- The day or the place.
  if v_moved then
    insert into public.task_events (host_id, task_id, kind, actor_id, cause, params)
    values (new.host_id, new.id, 'moved', v_actor,
            coalesce(v_named, v_by_actor,
                     case when new.reservation_id is null then 'system' else 'booking_changed' end),
            jsonb_strip_nulls(jsonb_build_object(
              'from_date', case when new.scheduled_date is distinct from old.scheduled_date
                                then old.scheduled_date end,
              'to_date', case when new.scheduled_date is distinct from old.scheduled_date
                              then new.scheduled_date end,
              'from_property', case when new.property_id is distinct from old.property_id
                                    then old.property_id end,
              'to_property', case when new.property_id is distinct from old.property_id
                                  then new.property_id end)));
  end if;

  if new.status is not distinct from old.status then
    return null;
  end if;

  -- The status.
  v_kind := case
    when new.status = 'cancelled' then 'cancelled'
    when new.status = 'expired' then 'expired'
    when new.status = 'done' then 'completed'
    when old.status in ('done', 'cancelled', 'expired') then 'reopened'
    when new.status = 'in_progress' and old.status in ('unassigned', 'assigned', 'accepted')
      then 'started'
    when new.status = 'accepted' and old.status in ('unassigned', 'assigned')
      then 'accepted'
    -- What a change of person does to the status (waiting again, or accepted
    -- by nobody yet) is said by that change. A move is not: an accepted
    -- cleaning moved to another day is assigned again, and says so.
    when v_person and new.status in ('unassigned', 'assigned') then null
    else 'status_changed'
  end;

  if v_kind is null then
    return null;
  end if;

  v_params := case v_kind
    when 'cancelled' then jsonb_strip_nulls(jsonb_build_object(
                            'from', old.status, 'assignee', old.assignee_id))
    when 'expired' then jsonb_strip_nulls(jsonb_build_object('assignee', old.assignee_id))
    when 'reopened' then jsonb_build_object('from', old.status)
    when 'status_changed' then jsonb_build_object('from', old.status, 'to', new.status)
    else '{}'::jsonb
  end;

  v_cause := null;
  if v_kind = 'cancelled' then
    v_cause := coalesce(
      v_named,
      v_by_actor,
      case
        -- The generator's rule of a live booking (20260926102000).
        when new.reservation_id is not null
             and not exists (select 1 from public.reservations r
                             where r.id = new.reservation_id
                               and r.status in ('new', 'modified')
                               and not r.is_block
                               and not public.is_service_booking(r.guest_name))
          then 'booking_cancelled'
        -- The generator wants active places only: the room, or its listing.
        when exists (select 1
                     from public.properties p
                     left join public.properties l
                       on l.id = p.parent_id and p.hostaway_unit_id is not null
                     where p.id = new.property_id
                       and (p.status <> 'active' or l.status <> 'active'))
          then 'property_unavailable'
        when new.reservation_id is null then 'system'
        else 'booking_changed'
      end);
  end if;

  insert into public.task_events (host_id, task_id, kind, actor_id, cause, params)
  values (new.host_id, new.id, v_kind, v_actor, v_cause, v_params);
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.journal_cleaning_time()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor    uuid := (select auth.uid());
  -- A cause a server function named for this transaction (20261015100000).
  v_named    text := nullif(current_setting('str_ops.task_cause', true), '');
  v_by_actor text;
  v_kind     public.task_event_kind;
  v_cause    text;
begin
  -- A name the journal does not know is ignored, as journal_task_change does.
  if v_named not in ('manager', 'head_tech', 'staff', 'staff_inactive', 'booking_cancelled',
                     'property_unavailable', 'booking_changed', 'system') then
    v_named := null;
  end if;

  if v_actor is not null then
    select case p.role
             when 'manager' then 'manager'
             when 'admin' then 'manager'
             when 'reception' then 'manager'
             when 'head_tech' then 'head_tech'
             else 'staff'
           end
      into v_by_actor
    from public.profiles p
    where p.id = v_actor;
  end if;

  if tg_op = 'INSERT' then
    if new.manual_time_on is not null then
      v_kind := 'time_set';
    else
      v_kind := 'time_dropped';
      v_cause := coalesce(v_named, v_by_actor, 'booking_changed');
    end if;
    insert into public.task_events (host_id, task_id, kind, actor_id, cause, params)
    values (new.host_id, new.id, v_kind, v_actor, v_cause,
            jsonb_strip_nulls(jsonb_build_object(
              'date', new.scheduled_date,
              'manual_on', new.manual_time_lost_on,
              'to', jsonb_build_object('time_from', new.time_from, 'time_to', new.time_to),
              'carried', true)));
    return null;
  end if;

  if new.manual_time_on is not null then
    v_kind := 'time_set';
  elsif old.manual_time_on is null then
    return null;
  elsif new.manual_time_lost_on is not null then
    v_kind := 'time_dropped';
    v_cause := coalesce(v_named, v_by_actor, 'booking_changed');
  else
    v_kind := 'time_auto';
  end if;

  insert into public.task_events (host_id, task_id, kind, actor_id, cause, params)
  values (new.host_id, new.id, v_kind, v_actor, v_cause,
          jsonb_strip_nulls(jsonb_build_object(
            'date', new.scheduled_date,
            'from_date', case when new.scheduled_date is distinct from old.scheduled_date
                              then old.scheduled_date end,
            'manual_on', case when v_kind = 'time_dropped' then old.manual_time_on end,
            'from', jsonb_build_object('time_from', old.time_from, 'time_to', old.time_to),
            'to', jsonb_build_object('time_from', new.time_from, 'time_to', new.time_to))));
  return null;
end;
$function$;
