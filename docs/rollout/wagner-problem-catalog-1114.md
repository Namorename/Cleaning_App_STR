# Выкат: уровень «Критическая» (CORE) и каталог категорий Wagner (CLIENT), 14–15.11

Что это и зачем — `docs/problem-categories.md`. Ядро и клиент — `docs/core-vs-client.md`.

## Решения владельца (15.11)

- **CORE:** четвёртый уровень срочности «Критическая» (`critical`; en Critical, cs Kritická) выше
  «Высокой». Сортируется выше неё, свой заметный бейдж в самом сильном тоне, подпись
  «Критическая». Уведомления — как у «Высокой»: будит главного техника и ночью, пометка «Срочно».
- **CLIENT:Wagnerstays:** P1 → critical, P2 → high, P3 → normal, P4 → low.
- Выкатка разрешена промптом 15.11 целиком (Android и iPhone): слова «выкатывай категории
  Wagner» и «публикуй field» названы заранее и покрывают деплой изменённых Edge-функций.
- Переводы en/cs категорий и синонимы — на проверку владельца (`docs/problem-categories.md` §5).

## Способ: флаг рядом с прежним `priority`

`problems.priority` остаётся из трёх значений; критическое задание — `priority = 'high'` и
`critical = true`. Старые телефоны (iPhone на OTA №12, Android на №19 и раньше) читают срочность
строгим `z.enum` из трёх внутри `z.array`: одно незнакомое значение уронило бы весь список заданий,
а через вложенное задание ремонта и весь список уборок. Значения вне трёх они не увидят при любых
данных. Подробно — `docs/problem-categories.md` §3.

## Места срочности

**Изменено:**

| Где | Что |
|---|---|
| БД `problems` | колонка `critical`, проверка `problems_critical_is_high`, триггер `problems_critical_follows_priority` |
| `report_problem`, `update_problem` | `p_critical boolean default null`; null — как раньше (правка старого телефона с `high` флаг сохраняет, ниже `high` — снимает) |
| каталог `problem_categories` | `critical`; задание под критической категорией — `high` + флаг |
| аналитика (8 функций) | ранг 4 у критической (средняя срочность по шкале 1–4), счётчик `problems_by_priority.critical`, фильтр `p_levels` (старый `p_priorities` оставлен) |
| API v1 / MCP | поле `critical` у задания; `priority=critical` в фильтре списка (`high` находит всё, что читается высоким) и при создании; OpenAPI, `docs/api-coverage.md`, каталог MCP; деплой `api` и `mcp` |
| общий пакет | шкала `PROBLEM_LEVELS` и `problemLevel` / `storedUrgency` / `byUrgencyFirst`; тон `critical` (светлая и тёмная тема); `STATUS_TONE`; подписи «Критическая / Critical / Kritická»; подсказка средней срочности 1–4 |
| телефон | карточка задания, страница задания, доска главного техника, ремонт в списке и на странице уборки — «Критическая» залитым тоном вместо «Срочно»; форма горничной — 4 уровня; метка категории; выборки `problems`, доски, уборок читают `critical`; отправка — `priority` + `critical` |
| панель | бейджи списка, доски и страницы задания; плашка ремонта в календаре; «Новое задание» — 4 уровня; аналитика — фильтр (4), столбики (4), `p_levels`, PDF |

**Не менялось, и почему:**

- push (`send-push`, правило `20261003160000`) — срочность решается в SQL по `priority = 'high'`,
  критическая уже «высокая»: поведение то же, текст тот же («Срочное задание»);
- журнал задания (`problem_events`) — срочность в событии «заведено» нигде не показывается;
- предложения из отзывов и чатов (`approve_signal_finding`, метки ИИ) и шаги планов решения —
  своя шкала из трёх на сервере; критической задание становится формой или каталогом;
- срочность заявок на расходники (`supply_priority`) и приоритет уборок (`tasks.priority`) — другие
  шкалы;
- карточка объекта (`listing_card`) читает срочность, но не показывает;
- сортировка: ни один список заданий в продукте не сортируется по срочности (только по времени),
  поэтому «выше» — это порядок уровней везде, где они перечислены (фильтры, формы, столбики,
  ранг 1–4, `byUrgencyFirst`).

## Порядок выката

Не в 03:00–04:40 UTC для любого шага, который пишет в базу.

**0. Чтение состояния:** голова облака (`remote_head.sql`), `origin/main`, группы EAS preview и
field, свободная память ≥ 4 ГБ.

**1. Ветка на `main`.** Если `main` ушёл вперёд — rebase и все проверки заново, имена и sha256
миграций здесь обновить.

**2. Миграция уровня, охраняемый `db push`.** Файл каталога на время выносится из каталога
миграций, иначе сухой прогон назовёт два файла:

```bash
mkdir -p "$PARK" && mv supabase/migrations/20261115100000_problem_categories.sql "$PARK/"
HEAD_WANT=20261111140000
LIST_WANT="20261115090000_problem_critical.sql"
SHA_WANT=d6565b790eca55add80ae7ad18fa89402e1215b77aa3dc6187be3bda3c1a735b
[ "$(sha256sum supabase/migrations/20261115090000_problem_critical.sql | cut -d' ' -f1)" = "$SHA_WANT" ] &&
[ "$(node scripts/cloud-read.mjs docs/rollout/remote_head.sql |
     node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s)[0].head))')" = "$HEAD_WANT" ] &&
[ "$(npx supabase db push --linked --skip-vault --dry-run --output-format json |
     node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).migrations.join(" ")))')" = "$LIST_WANT" ] &&
npx supabase db push --linked --skip-vault
mv "$PARK/20261115100000_problem_categories.sql" supabase/migrations/ && sha256sum -c <<< "<sha каталога>  supabase/migrations/20261115100000_problem_categories.sql"
```

Проба: `node scripts/cloud-read.mjs docs/rollout/probe_problem_critical.sql` = `AFTER_LEVEL` из
`rehearsal-problem-categories-1114.mjs` (голова `20261115090000`, 133, `analytics_with_levels` 8,
`problems.critical`, проверка и триггер, `priority_values` `low,normal,high`, md5 функций).

**3. Миграция каталога** — та же застава: `HEAD_WANT=20261115090000`,
`LIST_WANT="20261115100000_problem_categories.sql"`,
`SHA_WANT=2a9701bbb13784ba4bf0aa32d5c8bce094ed0ebb6fc9231c81dc34ad9f260604`. Пробы
`probe_problem_categories.sql` и `probe_problem_critical.sql` = `AFTER_BOTH_*`.

**4. Edge-функции — только изменённые:** `npx supabase functions deploy api mcp` (обе бандлят
`supabase/functions/api/routes.ts`; `_shared/` не менялся). Проверка: `GET /v1/tasks?priority=critical`
без ключа — 401, с ключом — 200.

**5. `main`.** `git merge --ff-only` ветки, `git push origin main` — Vercel выкатывает панель.

**6. OTA.** Перед ним `npx supabase migration list --linked`: все локальные миграции в облаке.
Натив не меняется (нет правок `app.json`, `package.json`, плагинов; новых внешних импортов нет).
- preview (Android): экспорт `ota-export.cmd` (рецепт №19: `env:exec preview`, `expo export` с одним
  воркером, без `.env`), `bundle-check.mjs` против живой №19 (`~/dev-tools/str-ops/dist-ota19`),
  `npx eas-cli update --branch preview --environment preview --skip-bundler --input-dir dist`;
- field (iPhone): `update:republish` новой группы preview на ветку field. iPhone на №12 получат всё
  с №13 по новую — владелец согласен.

**7. Последним — данные Wagner и режим** (только после обоих OTA):

```bash
npx supabase db query --linked -f docs/one-off-writes/wagner-problem-categories.sql
npx supabase db query --linked -f docs/one-off-writes/wagner-problem-report-mode-catalog.sql
```

**8. Пробы:**
- каталог читается: `probe_wagner_problem_categories.sql` — `live` 27, `by_level` «critical 6, high 7,
  normal 6, low 8», `mode` `catalog`, `other_companies_not_free_text` 0, `catalogue_md5`
  `fb3545a5664352098644c5db00abae38` (репетиция);
- сервер по категории ставит срочность (P1 → critical), запрос без категории — как раньше:
  `npx supabase db query --linked -f docs/one-off-writes/wagner-probe-report-rolled-back.sql` — ответ
  ошибкой `PROBE OK: …`, транзакция откатывается целиком;
- компании без настройки — `free_text`; старый клиент: `priority_values` `low,normal,high` и ни одной
  строки вне них.

## Откат

При провале пробы после облачного шага — по порядку. Сначала уходит код, который читает новую
схему (телефоны, панель, API): старый код работает на новой схеме без изменений, а новый на старой
— нет (42703 на `critical` и `category_id`, PGRST202 на `p_levels` и `p_critical`).

1. `docs/one-off-writes/wagner-problem-report-mode-free-text.sql` — режим `free_text`;
2. `docs/one-off-writes/wagner-problem-categories-rollback.sql` — категории архивируются, ни одна
   не удаляется;
3. если OTA уже вышло — `update:republish` прежних групп: preview №19
   `93191573-a27e-4505-b075-7fb2e15daaa1`, field №12 `1c5c6ce9-e1fe-447a-8390-36cdc657c4ea`;
4. если `main` уже обновлён — `git revert` коммитов ветки и push (прод-деплой панели), дождаться
   Vercel READY;
5. функции `api` и `mcp` — деплой из `b25ba5b`;
6. `docs/one-off-writes/problem-categories-rollback.sql`, затем
   `npx supabase migration repair --status reverted 20261115100000 --linked`;
7. `docs/one-off-writes/problem-critical-rollback.sql` — сначала все критические становятся
   высокими, потом уходит уровень; отказывает, пока каталог на месте. Затем
   `npx supabase migration repair --status reverted 20261115090000 --linked`.

## Репетиция (15.11)

Временная база `rehearsal_1028` в локальном контейнере, стенд не тронут:

```bash
node docs/rollout/rehearsal-db-1028.mjs create
node docs/rollout/rehearsal-problem-categories-1114.mjs
node docs/rollout/rehearsal-db-1028.mjs drop
```

Итог 12:07 UTC: **REHEARSAL GREEN**, 78 шагов:
- откат каталога и откат уровня (он отказывает, пока каталог на месте) дают ровно облачные пробы
  «до» обеих: 13 функций с md5 облака;
- старый телефон пишет до выката, на каждом шаге и после отката; критическое задание он читает
  `high`; его правка с `high` флаг сохраняет;
- миграция уровня одна, затем каталога; пробы `AFTER_LEVEL` и `AFTER_BOTH`;
- наборы `problem_critical` (35), `problem_categories` (60), `table_grants` (26), `problems` (80),
  `api_v1` (124), `head_tech_push` (30), `analytics` (67), `analytics_series` (9);
- данные: 27, P1–P4 6/7/6/8, уровни critical/high/normal/low, второй запуск отказан;
- Затопление (P1) с телефона «low» — `high` + флаг; Wi-Fi (P2) — `high`; Смесители (P3) с «high» —
  `normal`; без категории — как раньше; главный техник разбужен для P1 и P2, не для P3;
- откатываемая проба — `PROBE OK`, заданий и пушей после неё столько же;
- откат данных архивирует 27; отчёт из очереди ложится на архивную категорию критическим;
- после отката уровня критические задания — «высокие»; повторный выкат обеих — `AFTER_BOTH`.

## Независимый обзор (15.11)

Три новых агента `ecc:code-reviewer` (сервер, телефон, панель) получили только дифф и код. Критичных
нет; одна серьёзная — контрактный тест API: тестовое задание без `critical`, которое спецификация
теперь требует (подтверждено прогоном: 705/1). Исправлено и перепроверено (707/707), плюс новый
контрактный тест на `critical`. Средние и мелкие исправлены в `20434e7`:
- порядок отката: код (телефоны, панель, `api`/`mcp`) уходит раньше SQL;
- телефон шлёт `p_critical` только когда он что-то значит — правка строки из кэша старой сборки не
  снимает флаг;
- тесты маршрутов, критической категории, строк без флага, фильтра (4), адреса `urg=critical`,
  `p_critical` панели, бейджа на странице задания; проверка контраста нового тона;
- md5 в шапке отката каталога, оговорка про `updated_at`, тип `ProblemLevel` в аналитике.

## Проверки ветки

Коммит `20434e7`; миграции не менялись с `a2ae500`/`098d41d`.

| Проверка | Итог |
|---|---|
| SQL, `npm run test:rls` после `db:reset` | 63 набора, 3102 проверки (новый `problem_critical` — 35, `problem_categories` — 60) |
| типы `db:types` | совпадают с коммитом |
| телефон | `tsc` чисто; `expo lint` 0 ошибок (3 старых предупреждения); jest 220 наборов / 3719 тестов |
| панель | `tsc` чисто, `eslint` чисто, vitest 206 файлов / 2952 теста (паритет API внутри) |
| скрипты | `test:scripts` 70 / 70 |
| функции | `test:fn` 707 / 707 |
| API | `api:docs` перегенерирован; spectral 6.11.1 — без замечаний |
| сборка панели | превью Vercel ветки — Ready |
| репетиция | REHEARSAL GREEN, 78 шагов (12:31 UTC) |
| облако до выката | голова `20261111140000`, 132; md5 13 функций = локальным «до» |
