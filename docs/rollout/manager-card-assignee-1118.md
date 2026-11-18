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

## Порядок выката

Не в 03:00–04:40 UTC для любого шага, который пишет в базу (миграция, данные).

1. Чтение состояния: голова облака `20261118200000` (138 миграций), `origin/main` `bf25653`, проба =
   `BEFORE` репетиции.
2. Миграция `20261118230000_manager_card_assignee.sql` одна, под заставой: `HEAD_WANT=20261118200000`,
   `SHA_WANT` — sha256 файла, сухой прогон называет ровно этот файл. Проба = `AFTER` репетиции (колонка,
   виды журнала и пуша, хеши функций, триггер, права: клиенту — `set_manager_card_assignee`, титулы —
   только `service_role`). **Момент миграции записать** — он нужен откату данных.
3. Edge-функция `send-push` (новый вид пуша и чтение названий при отправке). `_shared/` не менялся;
   `send-push` его импортирует, но других функций правка не касается. До деплоя старая `send-push`
   откладывает строку нового вида как `skipped` (её назначений до выката клиентов не бывает).
4. `main` — перемотка (ff-only) на ветку этапа, push; Vercel Ready, `/login` 200.
5. OTA: preview, затем field (republish) — экспорт `ota-export.cmd` в дереве
   `cleanings-cancel-overdue-1105`, `bundle-check` против живого №23
   (`~/dev-tools/str-ops/day-1118/dist-ota23`), натив против коммита №23 (2831963) пуст.
6. Данные последними: `npx supabase db query --linked -f docs/one-off-writes/manager-cards-owner-assignee.sql`;
   проба — у карточек без исполнителя остались только снятые людьми.

## Старые телефоны и старая панель

Колонка необязательная, старые клиенты её не читают; вид журнала `assignee_changed` телефон OTA №23
пропускает (фильтр по известным видам), старый бандл до досок их не видит вовсе. Новый вид пуша:
телефон без него не разбирает данные нажатия и просто открывает приложение. Статусы и прежние значения
не тронуты (проба сверяет списки). Создание карточки старым клиентом ставит владельца исполнителем —
это делает сервер.

## Откат

В обратном порядке, не в 03:00–04:40 UTC:

1. Данные: в `manager-cards-owner-assignee-rollback.sql` вписать `c_migrated` (момент шага 2), затем
   `npx supabase db query --linked -f docs/one-off-writes/manager-cards-owner-assignee-rollback.sql`.
2. OTA: republish №23 — preview `b844f1fa-6694-417d-8a52-aaf71cd2cd2b`, field
   `9a4ff5cb-3045-481c-afc5-69e29a58b5ff`.
3. `git revert` коммитов этапа в `main`, Vercel Ready.
4. `send-push` из `main` до этапа (`bf25653`): `npx supabase functions deploy send-push`.
5. `npx supabase db query --linked -f docs/one-off-writes/manager-card-assignee-rollback.sql` (вернёт три
   тела функций, снимет две функции и триггер, строки «исполнитель изменён», колонку), затем
   `npx supabase migration repair --status reverted 20261118230000 --linked`. Значение
   `board_card_assigned` в enum остаётся (его нельзя удалить; старая `send-push` такие строки
   откладывает).
