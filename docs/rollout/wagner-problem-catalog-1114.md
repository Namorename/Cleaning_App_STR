# Выкат каталога категорий заданий (CLIENT:Wagnerstays, 14–15.11)

Что это и зачем — `docs/problem-categories.md`. Ядро и клиент — `docs/core-vs-client.md`.

## Статус: ОСТАНОВЛЕНО до выката (условие СТОП)

Ничего не выкачено. Облако, `main`, Vercel и обе ветки OTA не тронуты.

Причина — правило владельца: «если в текущей шкале меньше 4 уровней и без смены поведения ядра
их не выразить — не угадывай, ничего не выкатывай». У ядра три уровня срочности (`low`, `normal`,
`high`), у клиента четыре (P1–P4). Варианты — `docs/problem-categories.md` §3. Всё остальное
сделано и проверено в ветке `client-wagner-problem-catalog-1114`.

Проба облака 15.11 01:39 UTC (`probe_problem_categories.sql`, только чтение):

- голова `20261111140000`, применено 132 — столько же файлов в каталоге до этой ветки;
- `report_problem(…6 аргументов)` `e784ff29…`, `update_problem(…4)` `ccb9c738…` — те же тела, что
  в файле `20260908130000` и на стенде;
- новых колонок и таблицы нет.

## Что нужно от владельца

1. **Вариант срочности: A, C, D или B** (`docs/problem-categories.md` §3). Для A, C и D меняются
   только четыре строки блока `levels` скрипта данных; сейчас там A. Для B нужна отдельная работа
   в ядре, и этот выкат её не включает.
2. **Переводы en/cs и синонимы** — на проверку (§5 там же). Сомнительное: «Баки».
3. Слово на выкат с выбранным вариантом. Слова «выкатывай категории Wagner» и «публикуй field» из
   запроса 14.11 действуют, если остальное зелёное. Но вариант срочности этот запрос не называет.

## Порядок выката (когда вариант выбран)

Не раньше 04:40 UTC и не в 03:00–04:40 UTC для любого шага, который пишет в базу.

**0. Чтение состояния:**
- голова облака (`remote_head.sql`);
- `origin/main`;
- группы EAS preview и field;
- свободная память не меньше 4 ГБ.

**1. Ветка на `main`.** Если `main` ушёл вперёд — rebase и все проверки заново (список «Проверки»
ниже).

**2. Миграция ядра, охраняемый `db push`.**

Сначала отдельный сухой прогон: убедиться, что он называет ровно один файл. Затем застава и push
одной командой:

```bash
HEAD_WANT=20261111140000
LIST_WANT="20261115100000_problem_categories.sql"
SHA_WANT=bf83d13dcdbd69090d954c6afbab814d059c7280a743c010d8a8db4414703a9a
[ "$(sha256sum supabase/migrations/20261115100000_problem_categories.sql | cut -d' ' -f1)" = "$SHA_WANT" ] &&
[ "$(node scripts/cloud-read.mjs docs/rollout/remote_head.sql |
     node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s)[0].head))')" = "$HEAD_WANT" ] &&
[ "$(npx supabase db push --linked --skip-vault --dry-run --output-format json |
     node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).migrations.join(" ")))')" = "$LIST_WANT" ] &&
npx supabase db push --linked --skip-vault
```

Проба после: `node scripts/cloud-read.mjs docs/rollout/probe_problem_categories.sql`.

| Поле | Ожидается |
|---|---|
| `head` | `20261115100000` |
| `applied` | 133 |
| `functions` | `problem_category_for_report(uuid) 4c19b6d0…`, `report_problem(…7) 38cd7fc3…`, `update_problem(…5) 5b4e08cf…` |
| `client_execute` | `report_problem:authenticated, update_problem:authenticated` |
| `columns` | `hosts.problem_report_mode, problems.category_id` |
| `catalogue_client_grants` | `authenticated:SELECT` |
| `catalogue_rls` | `true` |
| `catalogue_policies` | `staff read the categories` |

**3. Edge-функции — нет.** Не менялись ни функции, ни `_shared/`, ни `api/`; спецификация и каталог
MCP те же (`npm run api:docs` поменял только `docs/api-coverage.md`).

**4. Данные Wagner.** Проверить блок `levels` по слову владельца, затем:

```bash
npx supabase db query --linked -f docs/one-off-writes/wagner-problem-categories.sql
```

Проба: `node scripts/cloud-read.mjs docs/rollout/probe_wagner_problem_categories.sql`.
- `live` 27, `archived` 0, `mode` `free_text`, `other_companies_not_free_text` 0;
- вариант A: `by_priority` «normal 6, low 8, high 13», `catalogue_md5` `af61950613f10bcfd3774e2a69e642bc`
  (на временной базе; с другим вариантом md5 другой).

**5. Настройка Wagner:**

```bash
npx supabase db query --linked -f docs/one-off-writes/wagner-problem-report-mode-catalog.sql
```

Проба Wagner: `mode` `catalog`.

Старые телефоны режим не читают и пишут название как раньше. Это безопасно, поэтому порядок
владельца сохраняется: настройка до OTA.

**6. `main`.** `git merge --ff-only` ветки в `main`, `git push origin main`. Vercel выкатит панель;
панель не менялась, меняются только общие типы и переводы.

**7. OTA:**
- preview (Android), затем field (iPhone);
- перед OTA: `npx supabase migration list --linked` — все локальные с `remote`;
- рецепт №19 (`next-ota-on-1-1-0`): экспорт через `env:exec preview` в дереве
  `cleanings-cancel-overdue-1105`, `bundle-check` против живой №19 (`dist-ota19`),
  `npx eas-cli update --branch preview --environment preview --skip-bundler --input-dir dist`;
- field — `update:republish` новой группы preview. iPhone получат всё с №13 по новую.

Натив не меняется: нет правок `app.json`, `package.json`, плагинов. Новых внешних импортов нет.

**8. Пробы после выката:**
- каталог читается с сервера: `probe_wagner_problem_categories.sql`, `live` 27;
- сервер ставит срочность по категории, запрос без категории — как раньше:
  `npx supabase db query --linked -f docs/one-off-writes/wagner-probe-report-rolled-back.sql`.
  Ответ — ошибка с текстом `PROBE OK: …`, транзакция откатывается целиком (отрепетировано: заданий и
  пушей после пробы столько же);
- для компаний без настройки ничего не изменилось: `other_companies_not_free_text` 0, а набор
  `problem_categories.sql` проверяет `free_text` по умолчанию.

## Откат

Если проба провалилась после облачного шага — по порядку:

1. `docs/one-off-writes/wagner-problem-report-mode-free-text.sql` — режим `free_text`;
2. если OTA уже вышло — `update:republish` прежней группы: preview №19
   `93191573-a27e-4505-b075-7fb2e15daaa1`, field №12 `1c5c6ce9-e1fe-447a-8390-36cdc657c4ea`.
   Сборка с `category_id` в выборке без колонки получит 42703;
3. `docs/one-off-writes/wagner-problem-categories-rollback.sql` — все 27 категорий архивируются,
   ни одна не удаляется: отчёт из очереди телефона ещё ляжет на свою категорию;
4. `docs/one-off-writes/problem-categories-rollback.sql` — схема назад, затем
   `npx supabase migration repair --status reverted 20261115100000 --linked`;
5. `main` — `git revert` коммитов ветки (это прод-деплой панели).

## Репетиция (15.11)

Временная база `rehearsal_1028` в локальном контейнере, стенд не тронут:

```bash
node docs/rollout/rehearsal-db-1028.mjs create
node docs/rollout/rehearsal-problem-categories-1114.mjs
node docs/rollout/rehearsal-db-1028.mjs drop
```

Итог: REHEARSAL GREEN.
- 133 миграции с нуля;
- откат ядра даёт ровно облачную пробу «до»;
- старый телефон пишет два задания;
- push миграции даёт пробу «после», старые задания не тронуты;
- наборы `problem_categories` (54), `table_grants` (26), `problems` (80), `api_v1` (124),
  `head_tech_push` (30) зелёные;
- данные: 27 записей, P1–P4 6/7/6/8, второй запуск отказан;
- режим `catalog`, горничная видит 27 категорий;
- Wi-Fi с телефона «low» записан как `high`, Смесители «high» — как `normal`, без категории — как
  раньше;
- главный техник получил срочный пуш только про Wi-Fi;
- откат данных отказывается при включённом режиме; после выключения архивированы все 27, удалённых
  нет;
- отчёт, выбранный до отката, ложится на архивную категорию (Wi-Fi, `high`);
- категорию, на которую есть задание, удалить нельзя;
- откат ядра даёт облачную пробу «до»; повторный push снова даёт «после»;
- проба `wagner-probe-report-rolled-back.sql` даёт `PROBE OK`, заданий и пушей после неё столько же.

## Независимый обзор (15.11)

Два новых агента `ecc:code-reviewer` получили только дифф и код: сервер и телефон. **Критичных и
серьёзных находок нет.** Что из средних и мелких исправлено:

- **сервер:**
  - откат данных только архивирует (удаление могло навсегда отказать отчёту из очереди телефона);
  - `problems.category_id` — `on delete restrict`;
  - скрипт данных отказывает на языке компании не `ru`, откат — на отсутствующей компании;
  - порядок колонок в пробе;
  - тесты: чужая компания с чужой категорией, правка под архивной категорией, набранная правка не
    трогает переводы, API — пять аргументов по позиции;
- **телефон:**
  - режим формы «липкий»: стёртое набранное название не превращает форму в выбор категории;
  - пустой список категорий не открывается;
  - копия настроек без `problem_report_mode` перечитывается сразу;
  - «wifi» находит «Wi-Fi» без синонима;
  - подпись поиска уточнена;
  - тест данных клиента вынесен в `wagner-catalogue.test.ts`, общие правила поиска — на своём наборе;
  - тесты правки задания из категории на уровне маршрута.

Оставлено владельцу:
- срочность запроса без категории не защищена — так требует «без category_id как раньше»;
  `docs/problem-categories.md` §2;
- в каталоге нет проверки `is_localized_text` на уровне таблицы — её нельзя поставить в CHECK (правило
  CLAUDE.md), а писатель сейчас один — скрипт, который её проверяет.

## Проверки ветки

Коммит `1c9facc` (миграция не менялась и после него), sha256 миграции
`bf83d13dcdbd69090d954c6afbab814d059c7280a743c010d8a8db4414703a9a`.

| Проверка | Итог |
|---|---|
| SQL, `npm run test:rls` после `db:reset` | 62 набора, 3061 проверка (до ветки 61 / 3007); новый набор — 54 |
| типы `db:types` | совпадают с коммитом |
| телефон | `tsc` чисто; `expo lint` 0 ошибок (3 старых предупреждения); jest 219 наборов / 3680 тестов (до ветки 214 / 3586 на 11.11) |
| панель | `tsc` чисто, `eslint` чисто, vitest 206 файлов / 2941 тест, включая паритет API |
| скрипты | `test:scripts` 70 / 70 (откатываемая проба лежит в `docs/one-off-writes/`: `docs/rollout/*.sql` обязаны проходить заставу чтения) |
| функции | `test:fn` 706 / 706; функции не менялись |
| API | `npm run api:docs` меняет только `docs/api-coverage.md`; `openapi.v1.json` и каталог MCP те же |
| репетиция | REHEARSAL GREEN (выше) |
| облако | проба 10:05 UTC 15.11 = проба 01:39 UTC: ничего не тронуто |

Сборка панели (`next build`) не запускалась: выката нет, а код панели не менялся. Перед выкатом —
по рецепту с заглушками `NEXT_PUBLIC_*`.
