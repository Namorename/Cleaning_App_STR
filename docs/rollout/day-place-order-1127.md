# Выкат: задания и уборки по дню, затем по объекту (CORE), 27.11

Правило и места — `docs/day-place-order.md`. Промпт владельца 27.11 разрешил выкат целиком; заранее
названные слова «выкатывай сортировку» и «публикуй field» покрывают перемотку `main` (Vercel
выкатывает панель сам), OTA в preview и field. База, функции и API не менялись, миграций нет.

## Выкачено 27.11.2026

| UTC | Шаг | Итог |
|---|---|---|
| 11:35 | `main` adab741 → e6aab47 (перемотка) | — |
| 11:37 | Vercel прод `woom-2949pfj70` | Ready; `/login` 200, `/problems` 307 на вход |
| 11:48 | экспорт бандла (рецепт №29, один воркер, 157 с при 4,4 ГБ свободной) | `bundle-check` против `day-1126/dist-ota29` (живой №29): RESULT OK |
| ~11:52 | OTA №30 preview | группа `0243b2ad-eca1-4286-aa4a-8f3e67b1d4d9` (Android `01a21cd9-8dc9-71c5…`, iOS `01a21cd9-8dc9-7692…`), runtime 1.2.0, коммит e6aab47 |
| ~11:53 | OTA №30 field (`update:republish`) | группа `7274a596-3277-4b42-af4e-97cc66b6ed5f` (Android `01a21cd9-e05d-7fa7…`, iOS `01a21cd9-e05d-7fd6…`); канал field → ветка field, не на паузе |

Копия бандла — `~/dev-tools/str-ops/day-1127/dist-ota30`.

С №30 на телефоны уходят и общие правки после №29 (51baead), выкачанные в панель без OTA: ключи
переводов (порядок вкладок досок и др.), помощники колонок досок, типы БД — только добавления.

## Проверки до выката (лёгкий режим владельца: без полного прогона и без независимого обзора)

- `tsc` панели и телефона — 0 ошибок; `eslint` изменённых файлов обоих приложений — 0.
- Общий пакет: `apps/web/src/lib/__tests__/day-place-order.test.ts` — русские, английские и чешские
  названия, числа в названиях, регистр и диакритика, пустой объект, одинаковые объекты, очередь,
  история и уборки; `problem-queue.test.ts` прежний — зелёные.
- Панель: vitest `features/tasks`, `features/problems`, `features/calendar`, `lib` — 95 файлов /
  1322 теста.
- Телефон: jest `features/tasks`, `problems`, `board`, `office`, `app` — 57 наборов / 1083 теста;
  новые случаи в `tasks`, `office`, `problems`, `board` и `postgrest-embeds` (строка `select` с
  `created_at`) — зелёные.
- Натив с 51baead не менялся (`app.json`, `eas.json`, `package.json`, `package-lock.json`, babel,
  metro, плагины, патчи); `migration list --linked` — все 150 миграций репозитория в облаке
  (голова `20261126160000`).

## Откат

- Панель: в Vercel сделать текущим прежний прод-деплой `woom-ifwjk5xqc` (adab741) или `git revert
  e6aab47` в `main`.
- Телефон: `update:republish --group 2e0694c3-e8e4-46e8-b24c-a3f8657f2c1b --destination-branch
  preview` и `update:republish --group 496c5a4e-7b6b-42c5-947d-1e9e3f0e458a --destination-branch
  field` (№29) из `apps/mobile`, с `--message … --non-interactive`. Откат в обе стороны: новое поле
  `created_at` у уборки необязательное, старый код его просто не читает.
