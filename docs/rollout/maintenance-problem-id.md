# Выкат: `problem_id` в работах карточки объекта

Одна миграция — `20261008100000_maintenance_problem_id.sql`, ветка
`maintenance-problem-id` (от `main` `0c8afa3`). Функция
`property_maintenance_tasks()` отдаёт девятую колонку `problem_id` —
задание, которое чинит ремонт. Без неё строка работы в карточке объекта не
видит разговор задания: ремонт, заведённый из задания, говорит в его ветке
(обзор 05.10, комментарий в `maintenance-tab.tsx` ветки `redesign-screens`).

## Что меняется и что нет

- `drop` + `create` одной функции в транзакции миграции, права повторены
  (`revoke` у `public` и `anon`, `execute` у `authenticated` и
  `service_role`). Таблиц и данных не трогает, крон гасить не нужно.
- Старый вызывающий не ломается: колонка добавлена последней, PostgREST отдаёт
  строки по именам, схема zod панели в `main` нестрогая и лишний ключ
  отбрасывает; телефон функцию не зовёт.
- Окно: между `drop` и `commit` вызов ждёт блокировку, после `commit`
  PostgREST перечитывает схему по событию DDL. Вызов, попавший в перечитывание,
  может получить отказ — панель повторит при следующем открытии карточки.
- **Клиентское чтение `problem_id` — только в ветке до выката схемы**
  (`CLAUDE.md`, «Push в `main` — это прод-деплой панели»). В этой ветке его нет:
  `main` после слияния читает прежние восемь колонок.

## Проверено локально (2026-10-08)

`supabase migration up --local` поверх стека с головой `20261004100000`
(без `db:reset`): `test:rls` — 40 наборов, 1736 проверок, новый раздел
`property_units.sql` «Which report a repair fixes» (до миграции — красный:
«column c.problem_id does not exist»); `db:types` — одна строка;
`typecheck:web`, `typecheck:mobile` чистые; тесты `apartments` панели 153/153.

## Застава — только словом владельца «пушим»

Из дерева ветки `maintenance-problem-id` (в каталоге миграций нет ничего, чего
нет в облаке, кроме этого файла), одной командой:

```bash
# голова облака сейчас; всё, что должно уехать, — один файл
HEAD_WANT=20261004100000
LIST_WANT="20261008100000_maintenance_problem_id.sql"
[ "$(npx supabase db query --linked -f docs/rollout/remote_head.sql |
     python -c 'import json,sys; print(json.load(sys.stdin)["rows"][0]["head"])')" = "$HEAD_WANT" ] &&
[ "$(npx supabase db push --linked --skip-vault --dry-run |
     python -c 'import json,sys; print(" ".join(json.load(sys.stdin)["migrations"]))')" = "$LIST_WANT" ] &&
npx supabase db push --linked --skip-vault
```

`db push` под агентом соглашается сам (CLI 2.115 при `CLAUDECODE`), застава —
только сверка головы и сухого прогона в той же команде; сбой разбора даёт
пустую строку и закрывает заставу (`docs/units-plan.md`, «Эксплуатация
выката»). Голова `20261004100000` снята 2026-10-08 через `cloud-read.mjs`.

## После push

1. `node scripts/cloud-read.mjs docs/rollout/postpush_maintenance_problem_id.sql`
   — ожидаемое в шапке файла: голова `20261008100000`; одна функция, результат
   кончается на `problem_id uuid`, md5/длина `b733a39b`/661 (до выката
   `dae6c32a`/638), ACL прежний; `anon` и `public` — `false`; ремонтов 9, все
   с заданием (на 08.10).
2. Панель в проде: карточка любого объекта с ремонтом, вкладка обслуживания —
   работы на месте (zod отбросил новую колонку).
3. Слить `maintenance-problem-id` в `main` (типы и тест); клиентское чтение —
   отдельной правкой в ветке `redesign-screens`, после «ок» владельца по ней.
