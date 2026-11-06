-- The manager's hand on the theme of a task (docs/property-intelligence-plan.md §4.5, stage 4).
--
-- The dictionary covers about 62 % of the staff's texts and misreads some of them. The nightly
-- refresh fills only a problem that has no theme, so a manual row was always safe from it; what
-- was missing is a way to write one. problem_themes has no client grants, so the panel reads and
-- writes through these two functions, which check the role.
--
-- A task's episode follows the hand at once where it exists. A task that had no theme gets its
-- episode from the next nightly refresh.

create or replace function public.problem_theme(p_problem_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not coalesce((select public.is_manager()), false) then
    raise exception 'The theme of a task is for managers only'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;

  return (
    select jsonb_build_object('theme', t.theme, 'source', t.source)
    from public.problem_themes t
    join public.problems p on p.id = t.problem_id
    where t.problem_id = p_problem_id and p.host_id = public.current_host_id()
  );
end;
$$;

-- A null theme takes the hand away: the dictionary may speak again at night.
create or replace function public.set_problem_theme(p_problem_id uuid, p_theme text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce((select public.is_manager()), false) then
    raise exception 'The theme of a task is for managers only'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;
  if not exists (select 1 from public.problems p
                 where p.id = p_problem_id and p.host_id = public.current_host_id()) then
    raise exception 'Problem % not found', p_problem_id
      using errcode = 'check_violation', hint = 'serverErrors.problemNotFound';
  end if;

  if p_theme is null then
    delete from public.issue_facts f
    where f.problem_id = p_problem_id and f.origin = 'stream' and f.detector = 'manual';
    delete from public.problem_themes t
    where t.problem_id = p_problem_id and t.source = 'manual';
    return public.problem_theme(p_problem_id);
  end if;

  if not exists (select 1 from public.issue_themes t where t.code = p_theme) then
    raise exception 'Theme % is not known', p_theme
      using errcode = 'check_violation', hint = 'serverErrors.problemThemeUnknown';
  end if;

  insert into public.problem_themes (problem_id, theme, source, detector)
  values (p_problem_id, p_theme, 'manual', 'manual')
  on conflict (problem_id) do update
  set theme = excluded.theme, source = 'manual', detector = 'manual', updated_at = now();

  update public.issue_facts f
  set theme = p_theme, detector = 'manual'
  where f.problem_id = p_problem_id and f.origin = 'stream';

  return public.problem_theme(p_problem_id);
end;
$$;

revoke all on function public.problem_theme(uuid) from public, anon;
revoke all on function public.set_problem_theme(uuid, text) from public, anon;
grant execute on function public.problem_theme(uuid) to authenticated;
grant execute on function public.set_problem_theme(uuid, text) to authenticated;
