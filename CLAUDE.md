# STR Ops

Операционная система для компании краткосрочной аренды: задачи на уборку из
броней Hostaway, чек-листы с фотофиксацией, репорты о поломках, статистика.

Дорожная карта — `docs/ROADMAP.md`. Установка, секреты и архитектурные
решения — `README.md`.

## Что важно помнить в этом репозитории

- **Первичный язык кода — английский, всегда.** Имена в схеме, код,
  комментарии, сообщения об ошибках и логи пишутся по-английски. Русский
  живёт ровно в трёх местах: коммиты, документация (`README.md`, `docs/`) и
  файлы перевода `packages/shared/src/i18n/locales/*.json` (общие для
  приложения уборщицы и веб-панели; ключ добавляется сразу в три языка,
  тест паритета ключей это проверяет). Русский комментарий или русский
  текст ошибки в старом файле переводится при следующей правке этого файла.
- **Веб-панель `apps/web` — Next.js, план и чек-лист в `docs/f10-plan.md`.**
  Роль для входа читается из `app_metadata` (`manager`, `admin`), guard в
  `src/proxy.ts` и в layout панели; данные защищает RLS, guard — удобство.
  В браузер уходят только `NEXT_PUBLIC_*`. React у панели закреплён на
  версии корня (`19.2.3`): вторая копия ломает хуки в тестах. Серверные
  компоненты не импортируют `react-i18next` — язык для них в `lib/language.ts`.
- **Текст для пользователя не хранится на сервере.** Приложение
  многоязычное, и язык сотрудника известен только приложению. Функция БД
  поднимает ошибку с английским `message` (он идёт в логи), стабильным
  ключом i18n в `hint` и параметрами подстановки — JSON-объектом в `detail`;
  переводит приложение через `serverErrorText()`. Сырое `error.message` на
  экран не выводится никогда: у неизвестной ошибки показывается общая
  переведённая фраза, а серверный текст — мелким шрифтом под ней, чтобы
  уборщица могла переслать его менеджеру.
- **Названия, которые вводит менеджер, хранятся с переводами.** Пара колонок:
  `x` — текст на языке компании (`hosts.default_language`), `x_i18n` —
  `{"en": "…", "cs": "…"}`. Читается перевод для языка сотрудника, а если его
  нет — сам `x`. Валидирует коды языков `is_localized_text()` в RPC записи
  (в CHECK её нельзя: она читает enum и потому `stable`). Так сделаны
  `checklist_modules` и `checklist_items`; той же формы держатся будущие
  разделы инвентаря и названия шагов.
- **Схема БД меняется только миграциями.** Источник правды —
  `supabase/migrations/`, правки через Studio надо снимать в файл:
  `npm run db:diff -- имя_миграции`.
- **После любой правки схемы:** `npm run db:reset`, затем `npm run test:rls`,
  затем `npm run db:types`. Без прогона тестов миграция не считается готовой.
- **Политика RLS недостижима без базового `GRANT`.** Права фильтруют строки
  внутри выданных привилегий; забытый grant даёт `permission denied`, а не
  пустую выборку.
- **`anon` в приложении не участвует** — привилегии в схеме `public` у него
  отозваны миграцией `20260825030000_revoke_anon.sql`. Не возвращать.
- **Роль пользователя читается из `app_metadata`**, никогда из
  `user_metadata`: последнее заполняет клиент при регистрации.
- **Серверные секреты не покидают сервер.** `SUPABASE_SECRET_KEY` и ключи
  Hostaway живут в корневом `.env` и используются только в Edge Functions.
  В приложения уходят лишь `EXPO_PUBLIC_*` значения.
- **Гранты клиентских ролей на таблицы — только явные.** Default privileges
  роли `postgres` в схеме `public` отозваны и у `anon`, и у `authenticated`
  (миграции `20260825030000`, `20260907150000`): новая таблица не даёт
  клиенту ничего, пока миграция не скажет `grant`. Набор
  `supabase/tests/table_grants.sql` держит матрицу «таблица → права
  `authenticated`» и падает на таблице, которой в матрице нет, — новую
  таблицу вписывать туда в той же миграции. Форма всегда `revoke all` +
  точечный `grant`: TRUNCATE и TRIGGER не подчиняются RLS.
- **Медиа уборки: строка раньше файла.** Файл в бакете `task-media` не
  существует без строки `task_media`: телефон регистрирует (`add_task_media`),
  грузит ровно на выданный путь (политика `storage.objects` сверяет со
  строкой), подтверждает (`confirm_task_media` проверяет объект). Клиент
  объекты не удаляет и не обновляет — только ретеншн (`purge-task-media`).
  Новый бакет — приватный, политики через строки, никогда `public = true`.
  У строки ровно один владелец: шаг задачи (`task_id` + `step_id`) или
  проблема (`problem_id`); новый вид медиа — новый владелец в том же
  конвейере, а не новая таблица.
- **Запросы из поля пишутся только через идемпотентные RPC** с id, который
  придумал телефон (`report_problem`, `save_supply_request`, `add_*_media`):
  повтор после потери сети возвращает ту же строку, а не дубль. Таблицы
  `problems`, `supply_requests`, `supply_request_items` у `authenticated`
  только на чтение.
- **Локальный и облачный Supabase ведут себя по-разному.** Хостинг выдаёт
  новым таблицам полный набор привилегий через default privileges, локальный
  стек — меньший. Проверять права нужно и на облаке после каждого `db:push`,
  а не только тестом: `information_schema.role_table_grants` для `anon` и
  `authenticated`.

## Правила ECC

Установлены выборочно: `common` (язык-агностик), `typescript` (Edge
Functions на Deno, будущая веб-панель на Next.js) и `react-native`
(приложение уборщицы на Expo, подключён в F5).

@.claude/rules/ecc/common/coding-style.md
@.claude/rules/ecc/common/patterns.md
@.claude/rules/ecc/common/security.md
@.claude/rules/ecc/common/testing.md
@.claude/rules/ecc/common/performance.md
@.claude/rules/ecc/common/code-review.md
@.claude/rules/ecc/common/development-workflow.md
@.claude/rules/ecc/common/git-workflow.md
@.claude/rules/ecc/common/agents.md
@.claude/rules/ecc/common/hooks.md

@.claude/rules/ecc/typescript/coding-style.md
@.claude/rules/ecc/typescript/patterns.md
@.claude/rules/ecc/typescript/security.md
@.claude/rules/ecc/typescript/testing.md
@.claude/rules/ecc/typescript/hooks.md

@.claude/rules/ecc/react-native/coding-style.md
@.claude/rules/ecc/react-native/patterns.md
@.claude/rules/ecc/react-native/performance.md
@.claude/rules/ecc/react-native/security.md
@.claude/rules/ecc/react-native/testing.md
@.claude/rules/ecc/react-native/accessibility.md
@.claude/rules/ecc/react-native/hooks.md
@.claude/rules/ecc/react-native/production-readiness.md
