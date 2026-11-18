# Выкат: доски менеджеров и режим менеджера на телефоне (CORE), 18–19.11

Промпт владельца 18.11; решения — `docs/manager-boards.md`. Миграция
`supabase/migrations/20261118200000_manager_boards.sql`; откат `docs/one-off-writes/manager-boards-rollback.sql`;
пробы `docs/rollout/probe_manager_boards.sql` (схема) и `probe_manager_boards_rows.sql` (строки); репетиция
`docs/rollout/rehearsal-manager-boards-1118.mjs`. Разрешение владельца в промпте: «выкатывай доски» и
«публикуй field» — миграции, изменённые функции, мёрж ff-only в `main`, OTA preview и field.

## Выкачено

| UTC | Шаг | Итог |
|---|---|---|
| 19:20 | чтение состояния | голова облака `20261118120000`, 137 миграций; проба `BEFORE`: досок нет, статусы уборок и заданий прежние |
| 19:59 | миграция `20261118200000_manager_boards` (застава: sha256 `ba86abe9…`, голова `20261118120000`, сухой прогон = 1 файл) | проба = `AFTER` репетиции: 138 миграций, RLS на 4 таблицах, права `authenticated: SELECT` и только, 4 политики, хеши 16 функций совпали, статусы прежние; строк 0 |
| — | Edge-функции | не менялись (`supabase/functions/` без изменений) |

Проверено до выката: репетиция GREEN (откат до `BEFORE`, миграция одна, наборы `manager_boards` 130,
`table_grants` 26, `retention_keeps_work` 27, `tenant_isolation` 18, `rls_smoke` 69, `api_v1` 124,
`cleaning_offs` 178, `problems` 80, `task_lifecycle` 26; сценарий владельца; отказ отката при данных;
повторный push); `test:rls` 67 наборов; обзор сервера — CRITICAL/HIGH нет, MEDIUM исправлены и
закрыты тестами (раздел 10 набора).

## Порядок выката

Не в 03:00–04:40 UTC для любого шага, который пишет в базу.

1. Чтение состояния: голова облака `20261118120000` (137 миграций), `origin/main` `8ffd318`, проба
   `probe_manager_boards.sql` = `BEFORE` репетиции (досок нет).
2. Миграция `20261118200000_manager_boards.sql` одна, под заставой: `HEAD_WANT=20261118120000`, `SHA_WANT` —
   sha256 файла, сухой прогон называет ровно этот файл. Проба = `AFTER` репетиции (хеши всех 16 функций,
   гранты, политики); `probe_manager_boards_rows.sql` — 0 строк; права в облаке — `pg_class.relacl`
   (только `authenticated: SELECT`, у `anon` и `PUBLIC` ничего).
3. Edge-функции: **ни одна не меняется** — `supabase/functions/` не тронут (`_shared/` и `api/` тоже;
   `npm run api:docs` не изменил ни `openapi.v1.json`, ни каталог `mcp`). Пуши не менялись: маршрут пуша
   отказа и прерывания тот же (`/task/[id]`), меняется экран по роли на телефоне.
4. `main` — перемотка (ff-only) на ветку этапа, push; Vercel Ready, `/login` 200.
5. OTA: preview, затем field (republish) — экспорт `ota-export.cmd` в дереве
   `cleanings-cancel-overdue-1105`, `bundle-check` против живого №22
   (`~/dev-tools/str-ops/day-1118/dist-ota22`), натив против коммита №22 (188a0a1) пуст, новых
   зависимостей нет.

## Старые телефоны

База только добавляет: четыре новые таблицы и функции; статусы уборок и заданий, их таблицы, пуши и
функции, которые читает приложение, не меняются (проба сверяет списки статусов до и после). Старые
бандлы новых таблиц не читают. Новый бандл на старой схеме не нужен: OTA выходит после миграции.

## Откат

Сначала код, потом база:
1. OTA: republish №22 — preview `74ec8993-4841-4fde-83a1-bdee503120c4`, field
   `d8af26cb-9b6a-4eb6-87f5-be38de83dcf0`;
2. `git revert` коммитов ветки в `main`, Vercel Ready;
3. если на досках уже есть данные — сначала выгрузка (`npx supabase db dump --linked --data-only
   -s public -t 'public.manager_board*' -f ~/.str-ops/backups/<дата>-boards.sql`, словом владельца) и
   очистка четырёх таблиц словом владельца: откат отказывает, пока есть хоть одна доска;
4. `manager-boards-rollback.sql` одной командой (`db query --linked -f`), затем
   `migration repair --status reverted 20261118200000 --linked`.

Репетиция проверяет откат до `BEFORE` облака, отказ отката при данных и повторный push.
