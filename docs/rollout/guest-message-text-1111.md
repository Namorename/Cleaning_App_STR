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
SHA_WANT=<sha256 файла, в отчёте выката ниже>
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
  - повторный накат — 61 из 61, 3005 проверок.

## 6. Выкачено

(заполняется по ходу)
