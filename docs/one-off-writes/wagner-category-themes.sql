-- CLIENT:Wagnerstays — the theme of «Качество объектов» each of the client's 27 categories is
-- about (owner, 2026-11-15; docs/problem-categories.md §6). A WRITE to the cloud: only on the
-- owner's word, never in 03:00–04:40 UTC, after migration 20261115150000_category_themes and
-- after both apps are published.
--
--   npx supabase db query --linked -f docs/one-off-writes/wagner-category-themes.sql
--   undo: docs/one-off-writes/wagner-category-themes-rollback.sql
--   probe: node scripts/cloud-read.mjs docs/rollout/probe_wagner_category_themes.sql
--
-- Only existing themes (issue_themes, themes-v1); none is made up. A category with no theme that
-- fits is left unbound: the dictionary reads its tasks' titles, as before. «Доставка» is no
-- quality issue. Then the themes of the company's catalogue tasks are written again at once
-- (refresh_category_themes; a manager's own choice stays); the night's refresh of «Качество
-- объектов» rebuilds the episodes from them.
--
-- One statement (the CLI's db query takes one): a do block. Running it twice writes the same.
do $$
declare
  c_host constant uuid := 'ce77c272-c330-4b74-ac98-c7d36cba8b2a';
  v_count  integer;
  v_themed integer;
begin
  perform set_config('lock_timeout', '3s', true);

  if not exists (select 1 from public.hosts h where h.id = c_host) then
    raise exception 'The company % is not in this database', c_host;
  end if;

  update public.problem_categories c
  set theme = m.theme, not_quality = m.not_quality
  from (values
    -- P1
    ('83ffda56-635c-4941-bedd-cb08b82e6675'::uuid, 'hot_water',          false), -- Горячая вода
    ('d62b476c-b82e-4d8a-90e9-d414597c1279'::uuid, 'heating',            false), -- Отопление
    ('a1ca0593-1f46-4f4a-9229-d2b85f31cdd1'::uuid, 'checkin_access',     false), -- Доступ в квартиру
    ('37659104-f5d6-4596-bb00-01130bc371cb'::uuid, 'electric_light',     false), -- Электричество полностью
    ('f5093c0c-58db-42bb-b5dc-ed6f5daa550c'::uuid, 'plumbing',           false), -- Прорыв труб
    ('d2e00844-d88c-4324-ab60-dbed5bb56a59'::uuid, 'plumbing',           false), -- Затопление
    -- P2
    ('2ca940fd-288f-43f5-a6df-93145e10cd67'::uuid, 'wifi',               false), -- Wi-Fi
    ('bacca1bc-6f84-4c28-87f7-78f703bada4d'::uuid, 'air_conditioning',   false), -- Кондиционер
    ('9293427f-b55f-4710-9d8b-51b0a2cdd79e'::uuid, 'kitchen_appliance',  false), -- Холодильник
    ('6268cb20-21c5-466b-8c25-3c597eb08502'::uuid, 'kitchen_appliance',  false), -- Плита
    ('f530619c-43e8-4f38-a187-85498c28c053'::uuid, 'shower_bath',        false), -- Душ
    ('46d47fc5-72f2-46f7-a63c-2a7227dd6aca'::uuid, 'electric_light',     false), -- Частичное отсутствие электричества
    ('91292260-09af-497a-9d37-0d2b5b9094b2'::uuid, 'plumbing',           false), -- Сантехника
    -- P3
    ('56e19d08-d142-4083-8b02-961546a1d6f2'::uuid, 'electric_light',     false), -- Освещение
    ('3cfd7ee1-4078-40dc-8d06-4b75ee250180'::uuid, 'appliance_other',    false), -- Мелкая бытовая техника
    ('ddc74d9b-6388-49ee-9bb2-6611f951db6b'::uuid, 'furniture',          false), -- Мебель
    ('1744627c-58f8-4682-ac8d-9a3648f16b5c'::uuid, 'lock_door',          false), -- Замки межкомнатных дверей
    ('8b4e8b0d-3fec-4833-8c79-80416c5cd97a'::uuid, 'drain_toilet',       false), -- Засоры
    ('7bed8f05-ae67-43c3-82d5-01bf1b4a26c6'::uuid, 'plumbing',           false), -- Смесители
    -- P4
    ('7a2fa5c7-6688-4658-b898-17a6bad801a8'::uuid, null,                 false), -- Косметические дефекты: no theme fits
    ('22168888-b535-420d-937f-5acd1bfe0661'::uuid, null,                 false), -- Царапины: no theme fits
    ('e80960c4-e5fe-47b7-94b0-2cefda65e660'::uuid, null,                 false), -- Покраска стен: no theme fits
    ('0e170fe9-4973-48fb-bc0b-23f548340527'::uuid, null,                 false), -- Декор: no theme fits
    ('b9a0f74f-0535-4b71-aa15-8a946b25150f'::uuid, 'furniture',          false), -- Замена мебели
    ('550e8872-7829-4235-8016-9c1040d0c3ab'::uuid, 'supplies_amenities', false), -- Дополнительные аксессуары
    ('b1d15e3f-5d86-45ad-845d-e339b05a373a'::uuid, null,                 false), -- Баки: no theme fits
    ('53254afb-447f-46df-ac19-e265389a9d9b'::uuid, null,                 true)   -- Доставка: no quality issue
  ) as m(id, theme, not_quality)
  where c.id = m.id and c.host_id = c_host;

  get diagnostics v_count = row_count;
  if v_count <> 27 then
    raise exception 'Bound % categories, not 27', v_count;
  end if;

  v_themed := public.refresh_category_themes(c_host);
  raise notice 'categories bound: 21 to a theme, 1 no quality issue, 5 left to the dictionary; catalogue tasks themed now: %',
    v_themed;
end $$;
