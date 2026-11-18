# Выкат: исполнитель карточки доски и чистка телефона (CORE), 18–19.11

Промпт владельца 18.11 вечером; решения — `docs/manager-boards.md`, «Этап 2». Миграция
`supabase/migrations/20261118230000_manager_card_assignee.sql`; её откат
`docs/one-off-writes/manager-card-assignee-rollback.sql`; данные
`docs/one-off-writes/manager-cards-owner-assignee.sql` и их откат `…-rollback.sql`; проба
`docs/rollout/probe_manager_card_assignee.sql`; репетиция `docs/rollout/rehearsal-manager-card-assignee-1118.mjs`.
Разрешение владельца в промпте: «выкатывай доски» и «публикуй field» — миграция, изменённые функции,
данные (скрипт проставления владельца), мёрж ff-only в `main`, OTA preview и field.

## Выкачено

| UTC | Шаг | Итог |
|---|---|---|
| 21:40 | чтение состояния | голова облака `20261118200000`, 138 миграций; проба `BEFORE`: колонки нет, 4 карточки |
| 22:35 | чтение перед выкатом | голова `20261118200000`, `origin/main` `bf25653`, проба = `BEFORE` репетиции (совпало всё), сухой прогон = 1 файл |
| 22:37:06 | миграция `20261118230000_manager_card_assignee` (застава: sha256 `6b52e741…`, голова `20261118200000`, сухой прогон = ровно этот файл) | проба = `AFTER` репетиции по всем полям: колонка, виды журнала и пуша, хеши функций, триггер `manager_board_entries_push_assigned`, `push_board_card_titles` — только `service_role`, права таблиц прежние; строк: 4 карточки без исполнителя |
| 22:37:40 | Edge-функция `send-push` | версия 7 → 8, `verify_jwt` прежний; `_shared/` и `api/` не менялись — других функций деплой не касается |
| 22:38 | `main` `bf25653` → `689bc05` (ff-only) | Vercel прод `woom-fiy7tftb8` Ready, `/login` 200 |
| 22:43 | OTA №24 **preview** | группа `6cd7c751-4323-4900-8ece-db6f7f33d8fc` (Android `01a1f0d4-2cc8-7603…`, iOS `01a1f0d4-2cc8-71d1…`), runtime 1.2.0, коммит 689bc05; натив против №23 (2831963) пуст; `migration list --linked` — всё совпадает; bundle-check против №23 OK; `dist` — `~/dev-tools/str-ops/day-1118/dist-ota24` |
| 22:44 | OTA №24 **field** (republish) | группа `d35bc0c9-b005-4d49-b7cd-c42a7c2d4b18` (Android `01a1f0d4-b76c-7c55…`, iOS `01a1f0d4-b76c-75dd…`), runtime 1.2.0 |
| 22:45:41 | данные `manager-cards-owner-assignee.sql` | исполнитель = владелец у 4 карточек; id для отката: `9ef3a619-954c-4912-b9f4-5984284dfb61`, `24a6450d-35d2-4337-8ada-b5088db38b0a`, `5a717d8b-3f75-4829-becf-d3735a242cfe`, `8c50da93-d3c7-4ce1-9619-0d4a41973ece`; проба строк: 4 из 4 с исполнителем, строк «исполнитель изменён» 0, пушей 0, слов в системных строках 0 |

Перед выкатом: репетиция GREEN (11 наборов, сценарий, откат данных по id, откат миграции, повторный push); `test:rls` 68 наборов; панель tsc 0 / eslint 0 / vitest 212 файлов (паритет API после записи триггерной функции — зелёный); телефон tsc 0 / lint 0 / jest 233 набора, 3989 тестов; функции 723, `deno check` `send-push` чистый; скрипты 70. Обзоры: сервер (HIGH — паритет, MEDIUM — устаревший пуш, разбор журнала в панели, откат данных — исправлены), панель (3 MEDIUM исправлены), телефон (1 MEDIUM исправлен); CRITICAL нигде.

## Порядок выката

Не в 03:00–04:40 UTC для любого шага, который пишет в базу (миграция, данные).

1. Чтение состояния: голова облака `20261118200000` (138 миграций), `origin/main` `bf25653`, проба =
   `BEFORE` репетиции.
2. Миграция `20261118230000_manager_card_assignee.sql` одна, под заставой: `HEAD_WANT=20261118200000`,
   `SHA_WANT` — sha256 файла, сухой прогон называет ровно этот файл. Проба = `AFTER` репетиции (колонка,
   виды журнала и пуша, хеши функций, триггер, права: клиенту — `set_manager_card_assignee`, титулы —
   только `service_role`).
3. Edge-функция `send-push` (новый вид пуша и чтение названий при отправке). `_shared/` не менялся;
   `send-push` его импортирует, но других функций правка не касается. До деплоя старая `send-push`
   откладывает строку нового вида как `skipped` (её назначений до выката клиентов не бывает).
4. `main` — перемотка (ff-only) на ветку этапа, push; Vercel Ready, `/login` 200.
5. OTA: preview, затем field (republish) — экспорт `ota-export.cmd` в дереве
   `cleanings-cancel-overdue-1105`, `bundle-check` против живого №23
   (`~/dev-tools/str-ops/day-1118/dist-ota23`), натив против коммита №23 (2831963) пуст.
6. Данные последними: `npx supabase db query --linked -f docs/one-off-writes/manager-cards-owner-assignee.sql`.
   Скрипт отвечает id карточек, которые изменил, — **записать их сюда**: откат данных берёт ровно их.
   Проба `probe_manager_card_assignee_rows.sql`: `unassigned_untouched` = 0 (если у всех владельцев
   досок офисная роль).

## Старые телефоны и старая панель

Колонка необязательная, старые клиенты её не читают; вид журнала `assignee_changed` телефон OTA №23
пропускает (фильтр по известным видам), старый бандл до досок их не видит вовсе. Новый вид пуша:
телефон без него не разбирает данные нажатия и просто открывает приложение. Статусы и прежние значения
не тронуты (проба сверяет списки). Создание карточки старым клиентом ставит владельца исполнителем —
это делает сервер.

## Откат

В обратном порядке, не в 03:00–04:40 UTC:

1. Данные: в `manager-cards-owner-assignee-rollback.sql` вписать `c_ids` (id, которые ответил шаг 6), затем
   `npx supabase db query --linked -f docs/one-off-writes/manager-cards-owner-assignee-rollback.sql`.
2. OTA: republish №23 — preview `b844f1fa-6694-417d-8a52-aaf71cd2cd2b`, field
   `9a4ff5cb-3045-481c-afc5-69e29a58b5ff`.
3. `git revert` коммитов этапа в `main`, Vercel Ready. Шаги 3–5 — подряд: панель до этапа не открывает
   карточку со строкой «исполнитель изменён» (строгий разбор видов журнала), пока шаг 5 её не удалит.
4. `send-push` из `main` до этапа (`bf25653`): `npx supabase functions deploy send-push`.
5. `npx supabase db query --linked -f docs/one-off-writes/manager-card-assignee-rollback.sql` (вернёт три
   тела функций, снимет две функции и триггер, строки «исполнитель изменён», колонку), затем
   `npx supabase migration repair --status reverted 20261118230000 --linked`. Значение
   `board_card_assigned` в enum остаётся (его нельзя удалить; старая `send-push` такие строки
   откладывает).
