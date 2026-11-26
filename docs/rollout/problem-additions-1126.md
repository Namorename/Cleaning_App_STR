# Выкат: фото, видео и комментарий менеджера к заданию (CORE), 26.11

Решения и состав — `docs/problem-additions-1126.md`. Ветка `manager-attachments-1126` от `main` `987b11e`.
Слова владельца — в промпте 26.11 заранее: «выкатывай закрытие» (миграция, изменённые функции, мёрж
ff-only в `main`) и «публикуй field» (OTA preview, затем field).

## Состав

- Одна миграция `20261126100000_problem_additions.sql` (sha256 сверяется заставой).
- Edge-функций нет: `supabase/functions/` и `_shared/` не менялись, каталог MCP тот же.
- `main` — перемотка (ff-only) на ветку; панель выкатывает Vercel.
- OTA №27: код телефона менялся (экран задания, лист закрытия, экран файлов, история). Натив не менялся
  (ни зависимостей, ни `app.json`). В field уходит и всё, что лежало в preview с 19.11 (№26: роль
  Reception и правки панели): field получает весь `main`.

## Порядок

Не в 03:00–04:40 UTC для шага, который пишет в базу.

1. Проба облака `node scripts/cloud-read.mjs docs/rollout/probe_problem_additions_1126.sql` = `BEFORE`
   репетиции (`docs/rollout/rehearsal-problem-additions-1126.mjs`, GREEN).
2. Миграция под заставой одной командой: sha256 файла = записанному, голова облака
   `HEAD_WANT=20261119143000`, сухой прогон называет ровно `20261126100000_problem_additions.sql`;
   затем `db push`. Проба = `AFTER` репетиции; права `problem_additions` в облаке — только `SELECT`
   у `authenticated`, ничего у `anon` и `PUBLIC`.
3. Функции — нет.
4. `git push origin manager-attachments-1126:main` (ff-only); Vercel Production Ready, `/login` 200.
5. OTA preview: `migration list --linked` (миграция в облаке), экспорт `ota-export.cmd`,
   `bundle-check` против живого №26 (`~/dev-tools/str-ops/day-1119/dist-ota26`),
   `eas update --branch preview --skip-bundler`. Затем field — `update:republish` той же группы.

## Выкачено

| UTC | Шаг | Итог |
|---|---|---|
| 12:35 | проба облака до | = `BEFORE` репетиции во всех полях схемы: голова `20261119143000`, md5 функций, права, политики, проверка владельца; добавлений 0, открытых заданий 56 |
| 12:42 | застава + `db push` | sha256 `0dd57a91…` = файлу, голова `20261119143000`, сухой прогон назвал ровно `20261126100000_problem_additions.sql`; push 12:42:24, exit 0 |
| 12:43 | проба облака после | = `AFTER` репетиции; `problem_additions`: `authenticated:SELECT` и ничего у `anon`/`PUBLIC`; внутренние функции (`publish_problem_addition`, `problem_closing_addition`, `journal_office_comment`) клиентам недоступны |
| — | функции | нет: `supabase/functions/` не менялся |
| 12:44 | `main` | `987b11e..8abd414` ff; Vercel Production Ready (`woom-8o6wctivy`), `/login` 200 |
| 13:00 | OTA №27 preview | группа `89f5d2f8-bfdb-4da3-9f9a-57704acdfd69` (Android `01a217f1-587a-7865…`, iOS `01a217f1-587a-72db…`), 1.2.0, `8abd414`; `migration list` — всё в облаке; натив против `902a440` не менялся; `bundle-check` против №26 — OK; dist — `~/dev-tools/str-ops/day-1126/dist-ota27` |
| 13:06 | OTA №27 field | `update:republish` → группа `80622bf2-e095-4529-9148-43ff32cc493d` (Android `01a217f7-2544-7d7a…`, iOS `01a217f7-2544-71ef…`); в field пришло и всё из №26 (19.11) |

## Откат

В обратном порядке, не в 03:00–04:40 UTC:

1. OTA: переопубликовать прежние группы — preview №26 `edede8d8-d7d7-4dd7-96ec-909624ee7453`,
   field №25 `ca4031bd-01b6-4f75-b224-e4f020130a3c` (`update:republish --group … --destination-branch …`
   из `apps/mobile`).
2. `git revert` коммитов ветки в `main` и push — Vercel выкатит прежнюю панель.
3. `npx supabase db query --linked -f docs/one-off-writes/problem-additions-rollback.sql` и
   `npx supabase migration repair --status reverted 20261126100000 --linked`. Пока никто ничего не
   добавил, база возвращается целиком (кроме двух значений перечисления журнала — Postgres их не
   удаляет, старые сборки читают их как «Другое событие»). Если добавления уже есть, снимаются
   клиентские функции, три новых аргумента закрытия и триггер журнала; таблица, файлы и их очистка
   остаются — их не читает никто из прежних версий.
