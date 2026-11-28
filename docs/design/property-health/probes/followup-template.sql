-- READ ONLY. For each chat card: was work filed on the same place family afterwards
-- (any «Задание» = problems row, of the same theme group or any), against a control window
-- before the card. Inputs: card ids, place ids, times, card kind and subject — no text.
with c(card_id, property_id, created, kind, subject, status, grp) as (values
/*VALUES*/
),
fam as (
  select c.*, coalesce(p.parent_id, p.id) as family
  from c join properties p on p.id = c.property_id
),
pr as (
  select pb.id, pb.created_at, pb.source, pb.status, coalesce(pp.parent_id, pp.id) as family,
         coalesce(it.theme_group, 'none') as grp, pb.task_id is not null as at_cleaning
  from problems pb
  join properties pp on pp.id = pb.property_id
  left join problem_themes pt on pt.problem_id = pb.id
  left join problem_categories cat on cat.id = pb.category_id
  left join issue_themes it on it.code = coalesce(pt.theme, cat.theme)
  where pb.status <> 'cancelled' or pb.source <> 'staff'
),
per_card as (
  select f.card_id, f.kind, f.subject, f.status, f.grp,
    exists (select 1 from pr where pr.family = f.family and pr.created_at between f.created - interval '1 day' and f.created + interval '14 days' and pr.grp = f.grp) as same_after,
    exists (select 1 from pr where pr.family = f.family and pr.created_at between f.created - interval '1 day' and f.created + interval '14 days') as any_after,
    exists (select 1 from pr where pr.family = f.family and pr.created_at between f.created - interval '1 day' and f.created + interval '14 days' and pr.grp = f.grp and pr.source = 'staff') as staff_same_after,
    exists (select 1 from pr where pr.family = f.family and pr.created_at between f.created - interval '45 days' and f.created - interval '30 days' and pr.grp = f.grp) as same_control,
    exists (select 1 from pr where pr.family = f.family and pr.created_at between f.created - interval '45 days' and f.created - interval '30 days') as any_control
  from fam f
)
select json_build_object(
  'cards', (select count(*) from per_card),
  'problems_since', (select min(created_at)::date from problems),
  'by_group', (select json_agg(x) from (
     select case when kind = 'access' or subject in ('internet_tv', 'other') then 'info_like' else 'physical' end as nature,
            count(*) as n, count(*) filter (where same_after) as same_after, count(*) filter (where staff_same_after) as staff_same_after,
            count(*) filter (where any_after) as any_after, count(*) filter (where same_control) as same_control, count(*) filter (where any_control) as any_control
     from per_card group by 1) x),
  'by_subject', (select json_agg(y) from (
     select subject, count(*) as n, count(*) filter (where same_after) as same_after, count(*) filter (where same_control) as same_control
     from per_card group by 1 order by 2 desc) y),
  'by_status', (select json_agg(z) from (
     select status, count(*) as n, count(*) filter (where same_after) as same_after
     from per_card group by 1) z)
) as result;
