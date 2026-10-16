# Выкат: дашборд владельца — журнал уборок и страница «Аналитика»

**Статус: три миграции в облаке с 2026-10-16 13:13 UTC** (журнал в конце; 2026-10-15 вечером —
предполёт только чтением, §1.6). Запись в облако (`db push`, откат), деплой
`manage-staff` и вставка шаблона письма — только словом владельца. Агент без вопросов делает лишь
чтение: `scripts/cloud-read.mjs`, сухой прогон, `curl` с публичным ключом.

Ветка схемы и панели — `dashboard-stage2-1015` (дерево `.claude/worktrees/dashboard-1014`), в `main`
не влита. Метрики и правила счёта — `docs/dashboard-metrics.md` (раздел 10 — решения 15.10).

## Что едет

| Миграция | Что делает | Блокировки и данные |
| --- | --- | --- |
| `20261015100000_task_events` | тип `task_event_kind`, таблица `task_events` (RLS: читает только менеджер своей компании; клиенты не пишут — `revoke all`, затем `select`), функция-триггер `journal_task_change` (definer), два триггера на `tasks`: `after insert`, `after update` статуса, исполнителя, дня, объекта | `lock_timeout 3s`; создание триггера берёт на `tasks` короткую SHARE ROW EXCLUSIVE (чтения не стоят, запись ждёт миг); строк не пишет — журнал с момента выката, прошлое не восстанавливается |
| `20261015110000_analytics` | 13 функций: служебные `analytics_is_test_listing`, `analytics_guard` и четыре `analytics_*_rows` — без прав у клиентов; шесть публичных (`analytics_summary` и пять таблиц `analytics_*_by_*`) — `execute` только у `authenticated`, внутри — `is_manager()` | только `create function`; таблиц не трогает, ничего не пишет |
| `20261015120000_analytics_series` | `analytics_summary` заново (тот же список аргументов, плюс `problems_by_priority` в ответе), новая `analytics_series` (`execute` у `authenticated`) | то же |

Отменённые задания (решение владельца 15.10 18:55, коммит `c0c299d`): строковая
`analytics_problem_rows` получила последний аргумент `p_cancelled boolean` (служебная, без прав у
клиентов), в ответе `analytics_summary` (обе миграции) — `problems_cancelled`.

У всех публичных функций последний аргумент `p_hide_archived boolean default null`: `null` —
«ничего не скрывать» (правило CLAUDE.md «новый аргумент RPC»), панель шлёт его только включённым.

Телефон эти функции и таблицу не читает: OTA и сборка не нужны. Триггеры журнала стоят на `tasks`
и срабатывают после записи строки, отказать ей не могут — поток горничной не меняется (проверено
локально 15.10: прогон «принять → начать → шаги → завершить» до и после миграции дал одинаковый
итог).

## Порядок: сначала миграции, потом слияние в `main`

`main` — это прод-панель (CLAUDE.md, «Push в `main`»). Панель ветки показывает пункт меню
«Аналитика» и зовёт `analytics_summary`, `analytics_series` и таблицы; без миграций в облаке
прод-панель получит `PGRST202` и страницу с ошибкой. Поэтому:

1. перед push — проверки ниже (агент);
2. застава и `db push` — **словом владельца «пушим»**;
3. проверки после push (агент и владелец);
4. слияние `dashboard-stage2-1015` в `main` — **отдельным словом владельца**, после пункта 3.

## 1. Перед push (агент, без записи)

1. **Ветка готова.** Голова `dashboard-stage2-1015` на origin; цикл панели зелёный (tsc, eslint,
   vitest, `next build`, паритет ключей); SQL-наборы `analytics.sql`, `analytics_series.sql`,
   `task_events.sql`, `table_grants.sql` зелёные; независимый обзор — без CRITICAL и HIGH. По
   правилу проекта перед схемным выкатом — короткий предполёт (`.claude/workflows/`; прошлый
   `dashboard-preflight` был для базового дашборда, этим трём миграциям нужен свой) — запуск
   словом владельца.
2. **Каталог миграций = облако + три файла.** В облаке голова `20261011100000` (15.10); две
   последние облачные миграции — `20261010100000_video_from_gallery` и `20261011100000_push_release` —
   лежат в ветке `phone-1-2-0`, а не в `main`. В дереве `dashboard-1014` их копии неотслеживаемые
   (не коммитить). Сверить побайтно:

   ```bash
   for f in 20261010100000_video_from_gallery.sql 20261011100000_push_release.sql; do
     [ "$(git show origin/phone-1-2-0:supabase/migrations/$f | sha256sum | cut -c1-64)" = \
       "$(sha256sum supabase/migrations/$f | cut -c1-64)" ] && echo "same $f" || echo "DIFFERENT $f"
   done
   ```

   Без них `db push` откажет сам («Remote migration versions not found in local migrations
   directory») — застава закрыта, не открыта.
3. **Ожидаемые md5 функций** вписаны в шапку `docs/rollout/postpush_dashboard.sql` (метка
   `functions`) 15.10 вечером для файлов ветки `c0c299d` с sha256 `e989ca81…` (100000),
   `39c91be6…` (110000), `811c6d89…` (120000). Сверить
   `sha256sum` трёх файлов в дереве push; если файлы с тех пор менялись — пересчитать и вписать
   заново: тело — текст между `$$` в файле (для
   `analytics_summary` — из `20261015120000`, он последний). Способ — накатить три файла в
   откатываемой транзакции на локальном стенде и прочитать `left(md5(prosrc), 8)` и
   `length(prosrc)` (стенд держит первые версии функций — старые сигнатуры в той же транзакции
   сначала `drop`). Пересчитывать до push, никогда после.
4. **Окно.** Не 03:00–04:40 UTC: ночные синк, генератор, метёлка, чистки (`docs/units-plan.md`,
   «Эксплуатация выката»). **Крон не гасится** (как на выкате 04.10, `staff-disable-plan.md`):
   если пачка вебхука совпадёт с первой миграцией и `lock_timeout 3s` истечёт, файл откатится
   целиком — повторить ту же команду. Если упадёт второй или третий файл, первый уже в облаке:
   перечитать голову и укоротить `LIST_WANT` до оставшихся.
5. **Проба «до»:** `node scripts/cloud-read.mjs docs/rollout/postpush_dashboard.sql` — голова
   `20261011100000`, у функций `overloads` 0 и пустые поля, `journal_table.exists` false,
   `triggers` и `kinds` — null.
6. **Предполёт 15.10 вечером — выполнен, только чтение** (ветка `c0c299d`, дерево `dashboard-1014`):
   - `npx supabase migration list --linked` — 109 миграций совпадают, голова облака
     `20261011100000`, только локальные — ровно `20261015100000`, `20261015110000`,
     `20261015120000`, только облачных нет. Значит, правленые на месте 110000 и 120000 в облаке
     не записывались ни в какой версии. Из дерева без `supabase/.temp/pooler-url` CLI отвечает
     «IPv6 is not supported» — файл скопирован из корня репозитория (`link` не запускался).
   - Облачные копии `20261010100000`, `20261011100000` побайтно равны `origin/phone-1-2-0`.
   - `npx supabase db push --linked --skip-vault --dry-run` — `"dryRun": true`, `migrations` —
     ровно три файла дашборда по порядку; голова облака после него — по-прежнему
     `20261011100000` (`cloud-read`).
   - **Копия схемы облака:** на локальном стенде в откатываемой транзакции сняты первые версии
     трёх миграций; отпечаток схемы `public` (по md5 на объект: 157 функций, 26 таблиц, 172
     ограничения, 88 индексов, 40 триггеров, 52 политики, 18 перечислений, RLS) совпал с облаком
     (тот же запрос через `cloud-read`), кроме `touch_updated_at()` — в облаке её тело с CR в
     концах строк, текст тот же; миграции дашборда её не трогают.
   - На этой копии три файла накатились **без ошибок**; проба `postpush_dashboard.sql` в той же
     транзакции — все метки как в шапке (голова `20261015120000`, 14 функций по одной, права,
     таблица, триггеры, виды). Наборы на копии: `task_events` 36/36, `analytics` 67/67,
     `analytics_series` 9/9; `table_grants` — 26 зелёных и одна красная: `release_push_token`
     доступна `anon`. Это не дашборд: функция облачной `20261011100000_push_release`, в облаке
     так и задумано, а набор в `main` и в ветке дашборда ещё не знает о ней (в `phone-1-2-0` он
     её ждёт). После слияния `phone-1-2-0` в `main` красная уйдёт.

## 2. Застава и push — только словом владельца «пушим»

Из дерева `.claude/worktrees/dashboard-1014`, одной командой. `db push` под агентом соглашается
сам (CLI 2.115 при `CLAUDECODE`); застава — сверка головы и полного списка сухого прогона в той же
команде; сбой разбора даёт пустую строку и закрывает заставу:

```bash
HEAD_WANT=20261011100000
LIST_WANT="20261015100000_task_events.sql 20261015110000_analytics.sql 20261015120000_analytics_series.sql"
[ "$(npx supabase db query --linked -f docs/rollout/remote_head.sql |
     python -c 'import json,sys; print(json.load(sys.stdin)["rows"][0]["head"])')" = "$HEAD_WANT" ] &&
[ "$(npx supabase db push --linked --skip-vault --dry-run |
     python -c 'import json,sys; print(" ".join(json.load(sys.stdin)["migrations"]))')" = "$LIST_WANT" ] &&
npx supabase db push --linked --skip-vault
```

Python на этом компьютере нет (с 10.10): разбор JSON перед запуском заменить однострочником на
`node -e` (тот же ключ `rows[0].head` и тот же список `migrations` через пробел); смысл заставы
прежний — любой сбой даёт пустую строку.

## 3. После push

1. **Проба** (агент): `node scripts/cloud-read.mjs docs/rollout/postpush_dashboard.sql` — метка за
   меткой по шапке файла:
   - голова `20261015120000`;
   - 14 функций, у каждой `overloads` 1, `search_path=""`, definer как в шапке, md5 и длины —
     вписанные в шаге 1.3;
   - **ACL функций:** `["authenticated"]` у семи публичных, `[]` у семи остальных (строковые,
     `analytics_guard`, `analytics_is_test_listing`, `journal_task_change`) — ни у одной нет
     `anon` и `PUBLIC`;
   - таблица: RLS включён, права — только `{"authenticated": "SELECT"}`, одна политика
     `managers read task events`;
   - два триггера на `tasks`, включены; двенадцать видов события по порядку.

   Любое расхождение — стоп и разбор, слияния нет.
2. **Вызов без входа отклоняется** (агент; ключ публичный, но в вывод не печатается): адрес и
   публикуемый ключ — из `apps/web/.env.local`.

   ```bash
   set -a; . apps/web/.env.local; set +a
   curl -s -o /dev/null -w "%{http_code}\n" -X POST "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/rpc/analytics_summary" \
     -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" -H "Content-Type: application/json" \
     -d '{"p_from":"2026-10-01","p_to":"2026-10-07"}'
   curl -s -o /dev/null -w "%{http_code}\n" "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/task_events?select=id&limit=1" \
     -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
   ```

   Ожидается `401` оба раза (в теле — `42501`, «permission denied for function/table»); `200` —
   стоп: значит `anon` получил право.
3. **Права менеджера** (владелец): превью ветки на Vercel (`npx vercel ls --cwd apps/web -m
   githubCommitRef=dashboard-stage2-1015`; превью смотрит на ту же облачную базу, нужен вход в
   Vercel) → вход менеджером → «Аналитика»: плитки, графики и таблицы загрузились, без «не удалось
   загрузить»; «Скрыть архивные» меняет цифры, если архивные объекты есть. Горничную и техника
   функции отклоняют ключом `serverErrors.managerOnly` — это держат SQL-наборы, в облаке не
   проверяем.
4. **Поток горничной** (владелец на телефоне, демо-горничная Apple на демо-объекте
   `900000000001`): одна демо-уборка на сегодня — «Принять» → «Начать» → шаги → «Завершить»; затем
   агент повторяет пробу — метка `demo_flow`: уборка `done`, события `accepted`, `started`,
   `completed` (плюс `created`/`assigned`, если она заведена после push). Поведение телефона то же,
   что до выката. Демо-уборка после этого выполнена — если для Apple нужна новая, менеджер заводит
   её в панели, как 10.10.
5. **История миграций** (агент): `npx supabase migration list --linked` — у всех локальных есть
   `remote`.

## 4. Слияние в `main` — словом владельца, после пункта 3

`dashboard-stage2-1015` → `main` коммитом слияния, затем Vercel: `Ready`, `/analytics` без сессии —
`307` на `/login`, менеджером — страница с цифрами. В каталоге миграций `main` после слияния будут
три файла дашборда, но не будет `20261010100000` и `20261011100000` (они в `phone-1-2-0`): `db push`
из `main` закроется сам, пока `phone-1-2-0` не влита. Это прежнее состояние `main`, не новое.

## 5. Откат — по каждой миграции, в обратном порядке, только словом владельца

Если панель уже в `main` — сначала вернуть её (revert слияния), потом схему: иначе прод-панель
останется без функций. Каждый откат — в Studio (SQL Editor, одним запуском) или `db query
--linked` (один оператор — тело в `do $$ … $$`), затем запись истории:
`npx supabase migration repair --status reverted <версия> --linked`. Сигнатуры — по ветке на
день составления; если функции менялись после, сверить с файлами.

**`20261015120000_analytics_series`:**

```sql
drop function public.analytics_series(date, date, text, bigint[], uuid[], public.task_status[],
  public.problem_status[], public.problem_priority[], boolean, boolean);
-- analytics_summary — обратно к телу 20261015110000: выполнить его блок
-- «create or replace function public.analytics_summary(…)» из того файла (сигнатура та же,
-- права при create or replace сохраняются).
```

**`20261015110000_analytics`** (после отката 120000):

```sql
drop function public.analytics_summary(date, date, bigint[], uuid[], public.task_status[],
  public.problem_status[], public.problem_priority[], boolean, boolean);
drop function public.analytics_cleanings_by_property(date, date, bigint[], uuid[], public.task_status[],
  public.problem_status[], public.problem_priority[], boolean, integer, integer, boolean);
drop function public.analytics_cleanings_by_cleaner(date, date, bigint[], uuid[], public.task_status[],
  public.problem_status[], public.problem_priority[], boolean, integer, integer, boolean);
drop function public.analytics_checkouts_by_property(date, date, bigint[], uuid[], public.task_status[],
  public.problem_status[], public.problem_priority[], boolean, integer, integer, boolean);
drop function public.analytics_problems_by_property(date, date, bigint[], uuid[], public.task_status[],
  public.problem_status[], public.problem_priority[], boolean, integer, integer, boolean);
drop function public.analytics_problems_by_technician(date, date, bigint[], uuid[], public.task_status[],
  public.problem_status[], public.problem_priority[], boolean, integer, integer, boolean);
drop function public.analytics_cleaning_rows(uuid, date, date, bigint[], uuid[], public.task_status[],
  boolean, boolean);
drop function public.analytics_checkout_rows(uuid, date, date, bigint[], boolean, boolean);
drop function public.analytics_occupancy_rows(uuid, date, date, bigint[], boolean);
drop function public.analytics_problem_rows(uuid, date, date, bigint[], uuid[], public.problem_status[],
  public.problem_priority[], boolean, boolean, boolean);
drop function public.analytics_guard(date, date);
drop function public.analytics_is_test_listing(bigint);
```

Данных эти две миграции не пишут — их откат ничего не теряет.

**`20261015100000_task_events`:**

```sql
set local lock_timeout = '3s';
drop trigger tasks_journal_cleaning_update on public.tasks;
drop trigger tasks_journal_cleaning_insert on public.tasks;
drop function public.journal_task_change();
drop table public.task_events;
drop type public.task_event_kind;
```

**Теряется журнал, записанный после push.** Если он нужен — сначала копия в закрытую схему, как
`archive_prelaunch` (`docs/launch-reset.md`, §4.2). Аналитика от журнала не зависит; порядок
120000 → 110000 → 100000 нужен для истории миграций.

## 6. `manage-staff`: деплой (словом владельца; от миграций не зависит)

**Что меняется.** С `9391773` (слияние «английский язык по умолчанию в панели») в `main` лежит
правка `supabase/functions/manage-staff/handler.ts`: новый человек без языка в запросе получает
`en`; правка существующего без языка — как раньше, `null`. Прод-панель уже сама шлёт `en` при
создании, поэтому до деплоя всё работает правильно (проверено обзором 15.10); деплой нужен для
любого другого вызывающего и чтобы облако совпадало с `main`.

**Кого деплоить.** Только `manage-staff`: общий код (`supabase/functions/_shared/`) слиянием не
менялся — `git diff f4d1c8e 9391773 --stat -- supabase/functions/` показывает лишь
`manage-staff/handler.ts` и `handler.test.ts` (правило CLAUDE.md о `_shared` не срабатывает).

1. Перед: `deno test supabase/functions/manage-staff/` из дерева на `main` (`9391773` или новее) —
   зелёный (15.10: 37/37), затем `git checkout -- deno.lock`, если тест его тронул.
2. Деплой из того же дерева (связанного с облаком — `supabase/.temp` из основного):

   ```bash
   npx supabase functions deploy manage-staff
   ```

3. После: `npx supabase functions list` — у `manage-staff` новая версия; в Dashboard → Edge
   Functions → `manage-staff` выключено «Enforce JWT» (`verify_jwt = false` из `config.toml`:
   иначе предполётный OPTIONS из браузера получит 401, и раздел «Команда» сломается). Раздел
   «Команда» в панели открывается, карточка сотрудника — тоже. Новую учётку ради проверки не
   заводить (уйдёт настоящее письмо).
4. Откат: тот же деплой из дерева на `f4d1c8e`.

## 7. Шаблон письма восстановления — вставить в панель Supabase (владелец)

Облако файл `supabase/templates/recovery.html` не читает: копия живёт в Dashboard →
Authentication → Emails → Templates → **Reset Password**. После слияния 15.10 порядок языков —
английский, чешский, русский. Вставить:

**Subject:**

```text
STR Ops: access · přístup · доступ
```

**Message body** (целиком, от `<!doctype html>` до `</html>`; служебный комментарий файла в письмо
не нужен):

```html
<!doctype html>
<html>
  <body style="margin: 0; padding: 24px; background: #f4f5f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; color: #111827;">
    <div style="max-width: 460px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 24px;">
      <p style="margin: 0 0 20px; font-size: 18px; font-weight: 600;">STR Ops</p>

      <p style="margin: 0 0 20px; font-size: 15px; line-height: 1.5;">
        Your access to the STR Ops app.<br />
        Přístup do aplikace STR Ops.<br />
        Доступ в приложение STR Ops.
      </p>

      <div style="padding: 12px 14px; background: #f4f5f7; border-radius: 8px; margin: 0 0 10px;">
        <div style="font-size: 12px; color: #6b7280; margin: 0 0 4px;">Login · Přihlašovací jméno · Логин</div>
        <div style="font-size: 16px; font-weight: 600; word-break: break-all;">{{ .Email }}</div>
      </div>

      <div style="padding: 12px 14px; background: #f4f5f7; border-radius: 8px; margin: 0 0 20px;">
        <div style="font-size: 12px; color: #6b7280; margin: 0 0 4px;">Password · Heslo · Пароль</div>
        <div style="font-size: 20px; font-weight: 700; letter-spacing: 0.5px; font-family: 'SF Mono', Menlo, Consolas, monospace; word-break: break-all;">{{ .Data.initial_password }}</div>
      </div>

      <p style="margin: 0 0 8px; font-size: 13px; color: #6b7280; line-height: 1.5;">
        This letter is sent both for a new account and for a changed password.
        If the password was changed, the previous one no longer works.
      </p>
      <p style="margin: 0 0 8px; font-size: 13px; color: #6b7280; line-height: 1.5;">
        Tento e-mail chodí při založení účtu i při změně hesla. Pokud bylo heslo
        změněno, předchozí už neplatí.
      </p>
      <p style="margin: 0; font-size: 13px; color: #6b7280; line-height: 1.5;">
        Это письмо приходит и на новую учётную запись, и на смену пароля. Если
        пароль сменили — прежний больше не работает.
      </p>
    </div>
  </body>
</html>
```

Перед «Save» проверить: `{{ .Email }}` и `{{ .Data.initial_password }}` остались ровно такими —
другое имя ключа Go-шаблон молча превратит в пустую строку, и письмо придёт без пароля
(`manage-staff/template.test.ts` держит только локальный файл). Источник текста — файл в `main`;
если файл поменяется, вставлять заново.

## Журнал

**2026-10-16, §2–3 — словом владельца 16.10.** Застава одной командой из дерева `dashboard-1014` на
`c0c299d`, 13:13 UTC: окно, голова ветки и `origin`, чистое дерево; `migration list --linked` —
голова `20261011100000`, только локальные — ровно три файла дашборда, только облачных нет; сухой
прогон — ровно три файла по порядку. `db push --linked --skip-vault` — 13:13:08–13:13:14 UTC, код 0.

- `migration list --linked`: 112 из 112, голова `20261015120000`.
- `postpush_dashboard.sql`: все метки как в шапке — 14 функций по одной, md5 и длины совпали все,
  definer и `search_path` как ожидалось; EXECUTE у `authenticated` только у семи публичных, у
  `anon` и `PUBLIC` — ни у одной; таблица: RLS, только `{"authenticated": "SELECT"}`, одна политика;
  два триггера включены; 12 видов по порядку. `journal` в первый час пуст, `demo_flow` — одна
  демо-уборка `assigned`, событий нет.
- Без входа: `analytics_summary`, `analytics_series`, `analytics_cleanings_by_property`,
  `analytics_guard` и `task_events` — `401` / `42501`.
- Уборок 6 900 и заданий 10 — до и после те же (строк, созданных до пробы «до», столько же).
- Находка: проба «до» (§1.5) в облаке не запускается — `42P01` на `public.task_events`: имя таблицы
  разбирается при анализе запроса, ветка `case` с `to_regclass` его не прячет. Состояние до push
  снято отдельным запросом (функций дашборда 0, таблицы и типа нет). Пробу после push это не задевает.
- Поток горничной (§3.4) владелец не проходит — решение 16.10; остальные проверки в силе.
