-- CLIENT:Wagnerstays — the catalogue of task categories (owner, 2026-11-14;
-- docs/problem-categories.md). A WRITE to the cloud: only on the owner's word,
-- never in 03:00–04:40 UTC, after migrations 20261115090000_problem_critical and
-- 20261115100000_problem_categories, and after both apps are published.
--
--   npx supabase db query --linked -f docs/one-off-writes/wagner-problem-categories.sql
--   undo: docs/one-off-writes/wagner-problem-categories-rollback.sql
--   probe: node scripts/cloud-read.mjs docs/rollout/probe_wagner_problem_categories.sql
--
-- 27 categories: P1 6, P2 7, P3 6, P4 8, in the owner's order. The names are
-- the owner's (Russian, the company's language, hosts.default_language = ru);
-- the English and Czech ones are translations awaiting the owner's check, as
-- are the synonyms: only the obvious ones.
--
-- THE OWNER'S DECISION (2026-11-15, docs/problem-categories.md §3): P1 critical,
-- P2 high, P3 normal, P4 low — the product's scale of four (20261115090000),
-- where critical is stored as priority high with the flag critical. The block
-- `levels` below holds it.
--
-- One statement (the CLI's db query takes one): a do block. It refuses to run
-- twice, and refuses a company that is not there.
do $$
declare
  c_host constant uuid := 'ce77c272-c330-4b74-ac98-c7d36cba8b2a';
  v_count integer;
begin
  perform set_config('lock_timeout', '3s', true);

  if not exists (select 1 from public.hosts h where h.id = c_host) then
    raise exception 'The company % is not in this database', c_host;
  end if;
  -- The names below are Russian: the company's language must be too.
  if (select h.default_language::text from public.hosts h where h.id = c_host) <> 'ru' then
    raise exception 'The company % does not speak Russian: the names would be in the wrong language', c_host;
  end if;
  if exists (select 1 from public.problem_categories c where c.host_id = c_host) then
    raise exception 'The company % already has categories: this script runs once', c_host;
  end if;

  insert into public.problem_categories (id, host_id, name, name_i18n, synonyms, priority, critical,
                                         sort_order)
  select v.id::uuid, c_host, v.name, v.name_i18n::jsonb, v.synonyms::text[], m.priority, m.critical,
         v.sort_order
  from (values
    -- P1, critical
    ('83ffda56-635c-4941-bedd-cb08b82e6675', 'P1',  1, 'Горячая вода',
     '{"en": "Hot water", "cs": "Teplá voda"}', '{бойлер}'),
    ('d62b476c-b82e-4d8a-90e9-d414597c1279', 'P1',  2, 'Отопление',
     '{"en": "Heating", "cs": "Topení"}', '{батарея,радиатор}'),
    ('a1ca0593-1f46-4f4a-9229-d2b85f31cdd1', 'P1',  3, 'Доступ в квартиру',
     '{"en": "Access to the apartment", "cs": "Přístup do bytu"}', '{ключ,домофон,вход,дверь}'),
    ('37659104-f5d6-4596-bb00-01130bc371cb', 'P1',  4, 'Электричество полностью',
     '{"en": "Total power outage", "cs": "Úplný výpadek elektřiny"}', '{свет}'),
    ('f5093c0c-58db-42bb-b5dc-ed6f5daa550c', 'P1',  5, 'Прорыв труб',
     '{"en": "Burst pipe", "cs": "Prasklé potrubí"}', '{труба}'),
    ('d2e00844-d88c-4324-ab60-dbed5bb56a59', 'P1',  6, 'Затопление',
     '{"en": "Flooding", "cs": "Zatopení"}', '{потоп,протечка,залив}'),
    -- P2, high
    ('2ca940fd-288f-43f5-a6df-93145e10cd67', 'P2',  7, 'Wi-Fi',
     '{"en": "Wi-Fi", "cs": "Wi-Fi"}', '{wifi,вайфай,вай-фай,интернет,internet,роутер}'),
    ('bacca1bc-6f84-4c28-87f7-78f703bada4d', 'P2',  8, 'Кондиционер',
     '{"en": "Air conditioning", "cs": "Klimatizace"}', '{кондер,кондей}'),
    ('9293427f-b55f-4710-9d8b-51b0a2cdd79e', 'P2',  9, 'Холодильник',
     '{"en": "Fridge", "cs": "Lednice"}', '{морозилка}'),
    ('6268cb20-21c5-466b-8c25-3c597eb08502', 'P2', 10, 'Плита',
     '{"en": "Stove", "cs": "Sporák"}', '{духовка,конфорка}'),
    ('f530619c-43e8-4f38-a187-85498c28c053', 'P2', 11, 'Душ',
     '{"en": "Shower", "cs": "Sprcha"}', '{лейка}'),
    ('46d47fc5-72f2-46f7-a63c-2a7227dd6aca', 'P2', 12, 'Частичное отсутствие электричества',
     '{"en": "Partial power outage", "cs": "Částečný výpadek elektřiny"}', '{свет,розетка}'),
    ('91292260-09af-497a-9d37-0d2b5b9094b2', 'P2', 13, 'Сантехника',
     '{"en": "Plumbing", "cs": "Vodoinstalace"}', '{унитаз,раковина,ванна}'),
    -- P3, medium
    ('56e19d08-d142-4083-8b02-961546a1d6f2', 'P3', 14, 'Освещение',
     '{"en": "Lighting", "cs": "Osvětlení"}', '{свет,лампа,люстра}'),
    ('3cfd7ee1-4078-40dc-8d06-4b75ee250180', 'P3', 15, 'Мелкая бытовая техника',
     '{"en": "Small appliances", "cs": "Drobné spotřebiče"}',
     '{чайник,фен,утюг,микроволновка,кофеварка,пылесос,тостер}'),
    ('ddc74d9b-6388-49ee-9bb2-6611f951db6b', 'P3', 16, 'Мебель',
     '{"en": "Furniture", "cs": "Nábytek"}', '{стул,стол,шкаф,кровать,диван}'),
    ('1744627c-58f8-4682-ac8d-9a3648f16b5c', 'P3', 17, 'Замки межкомнатных дверей',
     '{"en": "Interior door locks", "cs": "Zámky vnitřních dveří"}', '{замок,дверь,ручка}'),
    ('8b4e8b0d-3fec-4833-8c79-80416c5cd97a', 'P3', 18, 'Засоры',
     '{"en": "Clogged drains", "cs": "Ucpané odpady"}', '{слив,канализация}'),
    ('7bed8f05-ae67-43c3-82d5-01bf1b4a26c6', 'P3', 19, 'Смесители',
     '{"en": "Taps", "cs": "Vodovodní baterie"}', '{кран,смеситель}'),
    -- P4, low
    ('7a2fa5c7-6688-4658-b898-17a6bad801a8', 'P4', 20, 'Косметические дефекты',
     '{"en": "Cosmetic defects", "cs": "Kosmetické vady"}', '{}'),
    ('22168888-b535-420d-937f-5acd1bfe0661', 'P4', 21, 'Царапины',
     '{"en": "Scratches", "cs": "Škrábance"}', '{царапина}'),
    ('e80960c4-e5fe-47b7-94b0-2cefda65e660', 'P4', 22, 'Покраска стен',
     '{"en": "Wall painting", "cs": "Malování stěn"}', '{стена,краска}'),
    ('0e170fe9-4973-48fb-bc0b-23f548340527', 'P4', 23, 'Декор',
     '{"en": "Decor", "cs": "Dekorace"}', '{}'),
    ('b9a0f74f-0535-4b71-aa15-8a946b25150f', 'P4', 24, 'Замена мебели',
     '{"en": "Furniture replacement", "cs": "Výměna nábytku"}', '{}'),
    ('550e8872-7829-4235-8016-9c1040d0c3ab', 'P4', 25, 'Дополнительные аксессуары',
     '{"en": "Extra accessories", "cs": "Doplňkové vybavení"}', '{}'),
    ('b1d15e3f-5d86-45ad-845d-e339b05a373a', 'P4', 26, 'Баки',
     '{"en": "Bins", "cs": "Popelnice"}', '{}'),
    ('53254afb-447f-46df-ac19-e265389a9d9b', 'P4', 27, 'Доставка (бельё, химия, кроватка и т. д.)',
     '{"en": "Delivery (linen, cleaning supplies, cot, etc.)", "cs": "Dovoz (prádlo, drogerie, postýlka atd.)"}',
     '{полотенца}')
  ) as v(id, level, sort_order, name, name_i18n, synonyms)
  join (values
    -- THE OWNER'S DECISION (2026-11-15): which level of the product each files with.
    ('P1', 'high'::public.problem_priority, true),   -- critical
    ('P2', 'high'::public.problem_priority, false),  -- high
    ('P3', 'normal'::public.problem_priority, false),
    ('P4', 'low'::public.problem_priority, false)
  ) as m(level, priority, critical) on m.level = v.level;

  get diagnostics v_count = row_count;
  if v_count <> 27 then
    raise exception 'Wrote % categories, not 27', v_count;
  end if;

  -- The translations as the write functions check them (is_localized_text):
  -- known languages only, no empty text — and both of en and cs present.
  if exists (select 1 from public.problem_categories c
             where c.host_id = c_host
               and not (public.is_localized_text(c.name_i18n) and c.name_i18n ?& array['en', 'cs'])) then
    raise exception 'A category lacks a translation';
  end if;
end $$;
