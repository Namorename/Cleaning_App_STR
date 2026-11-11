# Сообщение гостя в задании из чата — выкат (11.11)

Слово владельца 11.11: задание из чата показывает сообщение гостя, прочитанное из Hostaway при
просмотре. Текст нигде не хранится. Как устроено — `docs/guest-message-text.md`.

Облачные шаги владелец назвал словами в задаче:
- одна аддитивная охраняемая миграция;
- деплой новой и изменённых Edge-функций;
- пуш в `main` fast-forward после проверок;
- OTA только в preview, field не публиковать.

Окно 03:00–04:40 UTC не задевать, чтение истории не задевать, Hostaway только читать.

## 1. Что меняется в облаке

- **Миграция `20261111140000_guest_message_text.sql`** (аддитивная):
  - колонка `signal_findings.task_link_ends` без значения по умолчанию;
  - триггер `signal_findings_task_link`;
  - таблица `raw.message_text_reads`;
  - новые функции `signal_task_link_ends`, `signal_findings_task_link`, `take_message_text_read`,
    `guest_message_target`;
  - заменены с теми же сигнатурами и правами `cut_signal_stay_links`, `purge_signal_data`,
    `purge_guest_message_links`. Для сигналов без задания их правила прежние.
- **Edge-функции:**
  - `guest-message-text` — новая, `verify_jwt = false`;
  - `guest-review-text` — изменена: список страниц панели вынесен в `_shared/panel-origin.ts`,
    поведение то же.
  - Другие функции `_shared/panel-origin.ts` не импортируют.
- **Панель:** fast-forward `main`, Vercel выкатывает сам.
- **Телефон:** OTA в preview. Нативной части нет: `app.json`, зависимости и плагины не менялись.

## 2. Застава и push

Голова облака перед выкатом — `20261111120000`.

```bash
HEAD_WANT=20261111120000
LIST_WANT="20261111140000_guest_message_text.sql"
SHA_WANT=7ae81fd8afd49b031101278f5d7b50636719859744d9c30a1a8063fbf5863fbe
[ "$(sha256sum supabase/migrations/20261111140000_guest_message_text.sql | cut -d' ' -f1)" = "$SHA_WANT" ] &&
[ "$(node scripts/cloud-read.mjs docs/rollout/remote_head.sql |
     node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(String(JSON.parse(s)[0].head))}catch{}})")" = "$HEAD_WANT" ] &&
[ "$(npx supabase db push --linked --skip-vault --dry-run --output-format json |
     node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(JSON.parse(s).migrations.join(' '))}catch{}})")" = "$LIST_WANT" ] &&
npx supabase db push --linked --skip-vault
```

**Проба после:** `node scripts/cloud-read.mjs docs/rollout/postpush_guest_message_text_1111.sql`.
Ожидаемое:
- голова `20261111140000`, колонка и триггер на месте;
- `raw.message_text_reads` — три колонки, никаких прав у `anon` и `authenticated`;
- `guest_message_target` и `take_message_text_read` вызывает только `service_role`;
- `signal_task_link_ends`, триггер и `cut_signal_stay_links` не вызывает никто;
- `purge_*` вызывает только `service_role`;
- `cut_knows_links = true`.

## 3. Функции

```bash
npx supabase functions deploy guest-message-text
npx supabase functions deploy guest-review-text
```

Дым после деплоя, без токена и без чтения Hostaway:
- POST без токена → 401 `serverErrors.notSignedIn`;
- запрос с чужим Origin → 403 без `Access-Control-Allow-Origin`;
- предзапрос с адреса панели → 204 со своим Origin.

## 4. Панель и телефон

1. Fast-forward `main` на голову ветки `guest-message-text-1111` и push. Vercel выкатывает
   Production.
2. OTA №19 в preview:
   - рецепт №18: `.cmd` в дереве `cleanings-cancel-overdue-1105`, `eas-cli env:exec preview "npx expo
     export …"`;
   - `bundle-check.mjs` против живой №18 (`~/dev-tools/str-ops/day-1111/dist-ota18`);
   - `eas update --branch preview --skip-bundler`.
3. Field не публикуется.

## 5. Откат

- **Панель:** `git revert` коммитов этапа на `main`, затем push.
- **Телефон:** перевыпустить в preview группу №18 `d8629527-0f84-402e-8d31-d4b5b3620143`.
- **Функции:**
  - `npx supabase functions delete guest-message-text`;
  - `guest-review-text` — передеплой с коммита до этапа (`1b9a37b`).
- **База** — только словом владельца и вне 03:00–04:40 UTC, после трёх шагов выше:

  ```bash
  npx supabase db query --linked -f docs/one-off-writes/guest-message-text-rollback.sql
  npx supabase migration repair --status reverted 20261111140000 --linked
  ```

  Откат возвращает три функции к прежним телам дословно и убирает новое. Сигналы, которые держала
  связь задания, обрежет следующая ночь (05:00 UTC) по старому правилу. Текста не терялось: его не
  было.
- **Откат отрепетирован** на временной базе `rehearsal_msg1111`:
  - после отката красные только три набора нового правила (`guest_message_text`, `guest_signals`,
    `guest_chats`), остальные 58 зелёные;
  - повторный накат — 61 из 61, 3007 проверок.

## 6. Выкачено 11.11

- **Проверки до записи в облако:**

  | Проверка | Итог |
  |---|---|
  | панель | tsc и eslint чисто, vitest 204 файла / 2920 тестов, сборка с заглушками — 24 страницы |
  | телефон | tsc чисто, eslint без ошибок (старые предупреждения), jest 215 наборов / 3599 тестов |
  | функции | test:fn 706, `deno check` обеих точек входа |
  | API | Spectral чисто, паритет — в vitest |
  | SQL | 61 набор / 3007 проверок; мутации 7 из 7; откат отрепетирован |

- **Независимый обзор безопасности:** критичных и серьёзных находок нет. Исправлено до выката:
  - обрезка стирает `task_link_ends`;
  - связь уходит вместе с именем, если проживание сократили.
- **21:15 UTC — `db push`.** Застава прошла: sha `7ae81fd8…`, голова `20261111120000`, сухой прогон назвал
  одну миграцию. Проба `postpush_guest_message_text_1111.sql`:
  - голова `20261111140000`, колонка и триггер на месте;
  - у `raw.message_text_reads` права только у `service_role`;
  - `guest_message_target` и `take_message_text_read` вызывает только `service_role`;
  - помощник, триггер и обрезку не вызывает никто;
  - заданий из карточек 0.
- **21:16 UTC — функции.** Выкачены `guest-message-text` и `guest-review-text`. Дым на обеих:
  - без токена — 401 `serverErrors.notSignedIn`;
  - чужой Origin — 403 без CORS;
  - предзапрос панели — 204 со своим адресом.
- **21:31 UTC — `main` = `bc0f58d`** (fast-forward с `1b9a37b`). Vercel: Production Ready.
- **OTA №19 в preview:**
  - группа `93191573-a27e-4505-b075-7fb2e15daaa1`, коммит `bc0f58d`, runtime 1.2.0;
  - сверка бандла с живой №18 — `RESULT: OK` (адрес, ключ, DSN те же);
  - `dist` — `~/dev-tools/str-ops/day-1111/dist-ota19`.
- Field не тронут. Политика не опубликована.
