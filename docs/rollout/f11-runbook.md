# F11 — выкат по шагам (runbook)

Рабочий список к `docs/f11-plan.md`, раздел «9. Выкат по шагам». Там — почему так;
здесь — что делать, какой командой и что проверить после. Подготовка владельца
подробно — `docs/f11-owner-steps.md`, правило заставы — `docs/units-plan.md`,
«Эксплуатация выката», проба облака — `docs/rollout/postpush_f11.sql`.

Составлено ночью 2026-09-29, **ничего из этого ещё не выполнено**. Кто делает шаг:
**В** — владелец в своём окне (меню, вход, секреты); **Я** — я по слову владельца
(запись в облако, деплой, push — только с его словом, CLAUDE.md).

## 0. Перед выкатом

- [ ] Ultrareview разобран (`docs/f11-ultrareview.md`), подтверждённые находки
      закрыты, ветки `f11-push` и `f11-native` чистые, `f11-native` содержит
      `f11-push` (`git merge-base --is-ancestor f11-push f11-native`).
- [ ] Рабочее дерево — на `f11-push` или `f11-native`, не на снимках для обзора
      (`f11-review-base`, `f11-push-review`, `f11-push-code` — только локальные,
      не сливать и не пушить).
- [ ] Облако: голова `20260927120000`, заданий крона 7 —
      `node scripts/cloud-read.mjs docs/rollout/remote_head.sql` и
      `node scripts/cloud-read.mjs --sql "select jobname, schedule, active from cron.job order by 1"`.
- [ ] Время `db push` выбрано (раздел 5): 22:00–02:00 UTC или 04:00–04:25 UTC.

## 1. Что владелец готовит заранее

Всё из `docs/f11-owner-steps.md`, по шагам. Команды `eas` — в своём окне из
`apps/mobile`; через `!` работают только команды, где всё задано флагами.

1. **EAS env `preview`** — адрес и публичный ключ **облака** для сборки (не
   секреты, `EXPO_PUBLIC_*`; значения — панель Supabase, Project Settings → API:
   URL проекта и publishable key, не локального стека):
   ```
   npx eas-cli env:set --name EXPO_PUBLIC_SUPABASE_URL --value https://<ref>.supabase.co --type string --visibility plaintext --environment preview
   npx eas-cli env:set --name EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY --value <publishable key> --type string --visibility plaintext --environment preview
   ```
   Флаги сверены по исходнику eas-cli 24.7.0: `--type string|file`,
   `--visibility plaintext|sensitive|secret`.
2. **`google-services.json`** — шаги 1–3 (файл-секрет в EAS, не в репозиторий).
3. **Ключ FCM V1** — шаги 4–5 (JSON сервисного аккаунта в EAS Credentials).
4. **Ключ APNs** — вручную не создавать: EAS создаст его на первой сборке iOS
   (шаг 13, ответ «да» на «Setup Push Notifications»).
5. **Sentry** (по желанию) — шаги 10–12, затем в EAS:
   ```
   npx eas-cli env:set --name EXPO_PUBLIC_SENTRY_DSN --value <dsn> --type string --visibility plaintext --environment preview
   npx eas-cli env:set --name SENTRY_ORG --value <org> --type string --visibility plaintext --environment preview
   npx eas-cli env:set --name SENTRY_PROJECT --value <project> --type string --visibility plaintext --environment preview
   npx eas-cli env:set --name SENTRY_AUTH_TOKEN --value <token> --type string --visibility sensitive --environment preview
   ```
   В проекте Sentry — «Prevent Storing of IP Addresses». Без DSN сборка
   работает, отчёты не шлются.
6. **Токен Expo для `send-push`** — шаг 16, но только **после** шага 3 выката.

## 2. Порядок выката

### Шаг 1. `db push` — пять файлов заставой (Я, по слову; окно из раздела 5)

Файлы: `20260928100000_push_recipients`, `20260928110000_task_accept`,
`20260928120000_participation_core`, `20260928130000_push_events`,
`20260928140000_push_sender`. Крон гасить не нужно: уборки миграции не двигают.
Начинать в **первые секунды нечётной минуты** — `process-webhook-events` ходит по
чётным (`*/2`), его пачка к этому времени закончена.

Одной командой, вызов Bash с `timeout` 600000 (иначе обрыв между файлами оставит
неясным, где встал push). Голова облака читается `cloud-read.mjs` — только чтением:

```bash
HEAD_WANT=20260927120000
LIST_WANT="20260928100000_push_recipients.sql 20260928110000_task_accept.sql 20260928120000_participation_core.sql 20260928130000_push_events.sql 20260928140000_push_sender.sql"
[ "$(node scripts/cloud-read.mjs docs/rollout/remote_head.sql |
     python -c 'import json,sys; d=json.load(sys.stdin); r=d if isinstance(d,list) else d.get("rows",[]); print(r[0]["head"])')" = "$HEAD_WANT" ] &&
[ "$(npx supabase db push --linked --skip-vault --dry-run |
     python -c 'import json,sys; print(" ".join(json.load(sys.stdin)["migrations"]))')" = "$LIST_WANT" ] &&
npx supabase db push --linked --skip-vault
```

Сухой прогон отдаёт JSON, только когда CLI запущен агентом (`CLAUDECODE`). В своём
окне владелец видит обычный текст — там порядок другой: `--dry-run`, глазами
сверить ровно пять файлов, затем `db push` и «y» на тот же список.

**Если push встал на середине** (сработал `lock_timeout 3s`): применённые файлы
остаются, голова облака — последний из них. Шаги 2–3 не начинать; повтор — той же
заставой с новой `HEAD_WANT` и остатком в `LIST_WANT`, в следующую нечётную минуту.
Промежуточные состояния безопасны: М1 и ядро участия ничего не делают сами, М2
принимает и старое «Взять» (`assigned`), триггеры М3 ничего не пишут без токенов.

### Шаг 2. Проба облака (Я, без вопросов)

```
node scripts/cloud-read.mjs docs/rollout/postpush_f11.sql
```

Сверить с шапкой файла метку за меткой: голова `20260928140000`, тела функций
(md5, длина, definer), права функций, таблиц (`pg_class.relacl`), кронов 10,
триггеры, `raw` закрыт. Любое расхождение — стоп и разбор до шага 3.

### Шаг 3. Деплой `send-push` и `sync-listings` (Я или В, по слову)

```
npx supabase functions deploy send-push
npx supabase functions deploy sync-listings
```

`sync-listings` — потому что бандлит тот же изменённый `_shared/caller.ts`
(память `deploy-shared-module-fanout`); поведение у него прежнее. Между шагом 1 и
этим крон `send-push` раз в минуту зовёт ещё не залитую функцию и получает отказ —
безвредно, строк в очереди нет (токенов нет).

Проверка: `npx supabase functions list` — обе функции с новой версией; через пару
минут в журнале `send-push` — прогоны без ошибок и предупреждение «EXPO_ACCESS_TOKEN
is not set» (до шага 4 так и должно быть).

### Шаг 4. `EXPO_ACCESS_TOKEN` (В)

Шаг 16 из `f11-owner-steps.md`: робот с наименьшей ролью → токен → в своём окне
```
npx supabase secrets set EXPO_ACCESS_TOKEN=<токен>
```
(не через чат и не через `!`: команда с секретом остаётся в истории сессии). Затем
переключатель «Enhanced security for push notifications». Проверка: в журнале
`send-push` пропало предупреждение о токене.

### Шаг 5. `f11-push` в `main` — панель (Я, по слову; только после шага 1)

`main` открыт в worktree `.claude/worktrees/f10-stage7-calendar`, поэтому
слияние — там:
```
git -C ".claude/worktrees/f10-stage7-calendar" merge --ff-only f11-push
git -C ".claude/worktrees/f10-stage7-calendar" push origin main
```
Vercel сам выкатит прод-панель (CLAUDE.md). До шага 1 нельзя: код панели читает
новую схему.

### Шаг 6. OTA Т1 на сборку 1.0.0 (Я, по слову) — точка невозврата М2

1. `npx supabase migration list --linked` — у всех пяти файлов непустой `remote`
   (память `ota-before-db-push`).
2. Бандл без нативных правок против последнего OTA (память
   `ota-last-bundle-commit`): `git diff <коммит последнего OTA>..main -- apps/mobile/app.json
   apps/mobile/package.json package.json package-lock.json apps/mobile/eas.json` — пусто
   или только JS-зависимости, которые уже есть в сборке 1.0.0.
3. Из `apps/mobile` дерева на `main` (фоном, идёт ~12 минут):
   ```
   npx eas-cli update --branch preview --environment preview --message "F11 T1: принять, настройки, ожидание сессии" --non-interactive
   ```

### Шаг 7. `f11-native` в `main` — коммит сборки (Я, по слову)

```
git -C ".claude/worktrees/f10-stage7-calendar" merge --ff-only f11-native
git -C ".claude/worktrees/f10-stage7-calendar" push origin main
```
После этого `main` — версия 1.1.0: следующий `eas update` из `main` уйдёт на
runtime 1.1.0 и до телефонов с 1.0.0 не дойдёт. Срочная правка для 1.0.0 — только
из ветки до этого коммита.

### Шаг 8. Сборка 1.1.0 (В, в своём окне)

```
npx supabase migration list --linked
cd apps/mobile
npx eas-cli build -p android --profile preview
```
APK — поверх 1.0.0. iOS — `npx eas-cli build -p ios --profile testflight`, затем
`npx eas-cli submit -p ios` (вход Apple ID, 2FA; `f11-owner-steps.md`, шаги 13–15).

## 3. Что проверить после каждого шага

| После | На телефоне (1.0.0, пока нет 1.1.0) | В панели |
|---|---|---|
| 1–2 | список уборок открывается; «Взять» свободную уборку работает (пишет `assigned`); начать и закончить | календарь, карточка уборки, сохранение; назначить ремонт |
| 3–4 | ничего нового | ничего нового |
| 5 | — | прод-деплой Vercel зелёный; календарь, уборки, задания; названия языков в настройках (`common.languages`) |
| 6 | два перезапуска — пришёл OTA; «Принять» у своей уборки; взятая свободная — сразу «принята»; «Настройки»: язык, пароль; вход после долгого офлайна ждёт сессию | статус «принята» виден в карточке и календаре |
| 8 | установка поверх 1.0.0 без потери входа; пояснение → системный вопрос → токен (проба: в `push_tokens` строка); менеджер назначает уборку на сегодня днём → push; нажатие открывает уборку; снятие — срочный push; сообщение в чате — push; выключенный вид не приходит; в 07:05 по Праге — сводка | — |

Для шага 8 на iPhone — ещё раздел 8.5 плана (холодный старт по нажатию).

## 4. Точка невозврата и откат

Откат — только новой миграцией той же заставой, Studio не трогать
(`postpush_f11.sql`, раздел ROLLBACK).

- **М3/М3b** — откатываются в любой момент: снять четыре триггера и три задания
  крона; `raw.push_outbox` и `raw.push_tickets` могут остаться.
- **Тела М2** (`save_task`, `assign_problem`, `set_property_status`,
  `property_open_cleanings`, `open_cleanings_by_listing`) — в любой момент:
  `accepted` просто останется `accepted`.
- **Страж М2 и политика `claim` — точка невозврата с первой строки `accepted`**,
  то есть с OTA Т1 (шаг 6). Старый страж не выпустит уборку из `accepted`, старая
  политика не даст её взять — горничная заперта. Дальше только вперёд; или одна
  миграция, которая сначала (со снятыми триггерами push) вернёт `accepted` в
  `assigned`, а потом старые страж и политику, — вместе с OTA, отзывающим Т1.
- **М1 и ядро участия** не откатываются отдельно: их зовут триггеры и чат.
- **Панель** — «Instant Rollback» на прошлый деплой в Vercel (В).
- **OTA** — `eas update:republish` прошлой группы возможен **только до** первой
  `accepted`: бандл без Т1 не умеет с ней жить.
- **Сборка 1.1.0** — не откатывается; ставится прошлый APK поверх, если нужно.

## 5. Почему `db push` в тихий час UTC, если прошлые выкаты шли днём

Прошлые дневные выкаты (19.09, 23.09 в 18:21 UTC — застава после чётной минуты,
`lock_timeout`) брали только блокировки, при которых **чтение не ждёт**:
`create or replace function` таблиц не блокирует, `create or replace trigger` берёт
SHARE ROW EXCLUSIVE — ждут только записи.

В F11 иначе, проверено на локальной базе 2026-09-29 (`pg_locks` в откатываемой
транзакции):
- М2 переставляет политику `claim` на `public.tasks`: `drop policy` берёт
  **ACCESS EXCLUSIVE**. Она ждёт каждую открытую транзакцию с `tasks`, и пока ждёт,
  за ней встают **все новые чтения** `tasks` — списки горничных, календарь панели,
  синк. `lock_timeout 3s` ограничивает ожидание, но не очередь за ним: до 3 с
  плюс остаток транзакции М2 всё, что читает уборки, стоит;
- М3a вешает четыре триггера на `tasks`, `chat_messages` и `reservations`
  (SHARE ROW EXCLUSIVE) — ждёт пишущих, а пачка вебхука каждые две минуты пишет
  брони и уборки;
- точек блокировки больше, чем у прошлых выкатов (две миграции, три таблицы), —
  выше шанс, что одна из них упрётся в `lock_timeout`, и push встанет на середине
  (безопасно, но нужен второй заход).

Днём это тоже можно: застава и `lock_timeout` отказывают, а не портят. Цена —
несколько секунд, когда у горничных стоит экран, и вероятный второй заход. Ночью
(22:00–02:00 UTC — 00:00–04:00 по Праге) никто не работает и не идёт ни одно
ночное задание (первое — `push-history-purge` в 02:40 UTC, и оно появится только с
F11; прежние — с 03:00). Окно 04:00–04:25 UTC — между `purge-webhook-events`
(03:50) и `purge-task-media-daily` (04:30), 06:00 по Праге. **Ночной час — не
требование, а более дешёвый риск**; решение за владельцем.
