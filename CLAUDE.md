# STR Ops

Операционная система для компании краткосрочной аренды: задачи на уборку из
броней Hostaway, чек-листы с фотофиксацией, репорты о поломках, статистика.

Дорожная карта — `docs/ROADMAP.md`. Установка, секреты и архитектурные
решения — `README.md`.

## Что важно помнить в этом репозитории

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
- **Локальный и облачный Supabase ведут себя по-разному.** Хостинг выдаёт
  новым таблицам гранты для `anon` через default privileges, локальный стек —
  нет. Проверять безопасность нужно и на облаке, а не только тестом.

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
