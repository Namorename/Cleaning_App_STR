# Доски, даты выполнения, карточки из чатов — выкат 26.11.2026

Промпт владельца 26.11 (без присмотра): `CORE` — доски менеджеров (видимость, свои колонки, передача),
дата выполнения заданий техников, выключатель «Карточки из чатов»; `CLIENT:Wagnerstays` — чаты
Wagner выключить, карточки из чатов убрать. Слова «выкатывай доски и даты» и «публикуй field» даны в
промпте заранее: миграции, данные, изменённые функции, `main` ff-only, OTA preview и field.
Запрет записи в базу 03:00–04:40 UTC.

Устройство: `docs/manager-boards.md` («Этап 4»), `docs/problem-due-date.md`, `docs/guest-chats.md` §9.
Ветка `boards-dates-chats-1126` от `main` `8154b31`.

## Что уезжает

| Что | Где |
|---|---|
| Миграция 1 | `supabase/migrations/20261126120000_board_columns.sql` — видимость, колонки, передача, вид пуша `board_transferred` |
| Миграция 2 | `supabase/migrations/20261126130000_problem_due_date.sql` — `problems.due_on`, `report_problem(…, p_due_on)`, `set_problem_due_date` |
| Функция | `send-push` (вид `board_transferred`, `push_board_titles`; карточка закрытой доски — без названия доски). Больше ничего: `_shared` не менялся (только тест), API/MCP не менялись |
| Панель | `main` → Vercel |
| Телефон | OTA (только JS) на 1.2.0: preview, затем field |
| Данные | `manager-boards-private.sql` (CORE); `wagner-chats-off.sql`, копия, `wagner-chat-cards-delete.sql` (CLIENT) |

## Порядок и заставы

1. **Чтение состояния** (`cloud-read.mjs`): голова облака `20261126100000`, проба
   `probe_boards_dates_1126.sql` = `probe_boards_dates_1126.before.json`; `origin/main` = `8154b31`.
2. **Миграция 1 под заставой, одна**: sha256 файла = записанному, голова = `20261126100000`
   (`HEAD_WANT`), сухой прогон называет ровно `20261126120000_board_columns.sql`; затем `db push`.
   Проба: схема = «после» репетиции; права новых таблиц в облаке — `authenticated:SELECT` у колонок, у
   передач ничего (через `pg_class.relacl`, не `information_schema`).
3. **Миграция 2 под заставой, одна**: голова = `20261126120000`, сухой прогон — ровно
   `20261126130000_problem_due_date.sql`. Проба.
4. **Функция**: `npx supabase functions deploy send-push`; `deno check` точки входа до него.
5. **`main` ff-only** → Vercel Ready, `/login` 200.
6. **OTA preview**: экспорт сценарием (одна копия, `--max-workers 1`), `bundle-check` против живого
   №28 (`~/dev-tools/str-ops/day-1126/dist-ota28`), `eas update --skip-bundler`; натив против №28 не
   менялся (сверка `git diff` по нативным файлам). Затем **field** — `update:republish`.
7. **Данные** последними: доски (закрыть существующие), затем чаты Wagner: выключить → копия → удалить.

Если проба провалилась — стоп и откат в обратном порядке (ниже), потом отчёт.

## Откат (обратный порядок)

1. Данные: `wagner-chat-cards-restore.mjs` → `restore.sql` → `db query --linked -f` (README в
   `~/.str-ops/backups/2026-11-26-chat-cards/`); чаты — нажатием админа в панели;
   `manager-boards-private-rollback.sql`.
2. OTA: republish №28 — preview `9807ccfe-ed25-4eca-8415-3d63ff3179df`, field
   `d95e19fa-72f0-4986-8db8-737a4d554204`.
3. Панель: `git revert` коммитов этой ветки в `main` (или Promote прежнего деплоя Vercel).
4. Функция: `send-push` из `8154b31` (`git checkout 8154b31 -- supabase/functions/send-push` во
   временном дереве и deploy).
5. База: `problem-due-date-rollback.sql`, `migration repair --status reverted 20261126130000`; затем
   `board-columns-rollback.sql`, `migration repair --status reverted 20261126120000`. Значение
   `board_transferred` в перечислении остаётся (Postgres его не удаляет; старая `send-push` пропускает
   такие строки).

Репетиция всего этого: `node docs/rollout/rehearsal-boards-dates-chats-1126.mjs` (временная база у
головы облака, синтетика в форме облака, все SQL-наборы на всех миграциях).

## Выкачено

| UTC | Шаг | Итог |
|---|---|---|
