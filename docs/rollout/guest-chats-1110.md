# Чаты за переключателем — выкат

Устройство — `docs/guest-chats.md`. Ветка `guest-chats-1110`. В ту же поставку входит правка строки
состояния «Гостей» (`426d857`): упавший разбор отзывов больше не прячется за удачной загрузкой.

**Разрешение владельца 10.11:** выключенное по умолчанию и аддитивное выкатывается заранее. Это
охраняемая миграция по рецепту, деплой изменённых функций и `main` fast-forward после всех проверок.
**Включение — только словом «включай чаты».** Окно 03:00–04:40 UTC не трогать. Чтение истории идёт
тиками 07:00–21:50 UTC, и push делается между тиками: миграция берёт короткую блокировку
`issue_facts`.

## Что едет

| Часть | Что | Как проверено |
|---|---|---|
| Миграция | `20261110120000_guest_chats.sql`, sha256 `52142a0594dfb2c36d047edd0f269840b5972bda71feb6222d6fa5762214068f` | `guest_chats.sql` 68; временная база: 56 наборов, 2 740 проверок; откат и повторный накат |
| Функции | `read-guest-messages` (новая; задания создаются выключенными), `classify-guest-signals` (правка `426d857`: сбой разбора отдельного отзыва — `is_ok = false`) | `test:fn`, `deno check` |
| Панель | `main` fast-forward, Vercel | tsc, eslint, vitest, `next build` |
| Телефон | не едет | код телефона не менялся, в общих переводах только ключи панели |

Секретов не добавляется: функция читает `GUEST_SIGNAL_KEY_SECRET`, `ANTHROPIC_API_KEY` и ключи Hostaway,
как `read-signal-history`.

## Порядок

1. **Миграция** — застава и push одной командой.
2. **Проба** `postpush_guest_chats_1110.sql`.
3. **Функции** — `read-guest-messages`, `classify-guest-signals`.
4. **`main`** — fast-forward, панель на Vercel.
5. **Слово «включай чаты»** — `guest-chats-on.sql` и проба через 15–30 минут.

Между шагами ничего не ломается. Старая панель после миграции читает то же: `signal_kind = review`,
`quality_theme_rows` и `quality_meta` отдают те же поля и ещё два новых. Функции чтения нет, пока
она не задеплоена, а её задания выключены.

### 1. Застава и push

```bash
HEAD_WANT=20261109120000
LIST_WANT="20261110120000_guest_chats.sql"
SHA_WANT=52142a0594dfb2c36d047edd0f269840b5972bda71feb6222d6fa5762214068f
[ "$(sha256sum supabase/migrations/20261110120000_guest_chats.sql | cut -d' ' -f1)" = "$SHA_WANT" ] &&
[ "$(node scripts/cloud-read.mjs docs/rollout/remote_head.sql |
     node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(String(JSON.parse(s)[0].head))}catch{}})")" = "$HEAD_WANT" ] &&
[ "$(npx supabase db push --linked --skip-vault --dry-run --output-format json |
     node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(JSON.parse(s).migrations.join(' '))}catch{}})")" = "$LIST_WANT" ] &&
npx supabase db push --linked --skip-vault
```

### 2. Проба

`node scripts/cloud-read.mjs docs/rollout/postpush_guest_chats_1110.sql`

| Поле | До (10.11, 18:29 UTC) | После |
|---|---|---|
| `head` | `20261109120000` | `20261110120000` |
| `raw` | пусто | `signal_message_queue`, `signal_message_runs`, `signal_message_state` |
| `raw_grants` | пусто | пусто |
| `exec` | пусто | 10 функций — `service_role`; `guest_message_place`, `guest_messages_shown`, `message_theme_finding`, `signal_message_month_start` — `-` |
| `jobs` | `{}` | `read-guest-messages` и `-0440` — `false`, `purge-guest-message-links` — `true` |
| `switch` | `null` | `null` (строки `message` нет) |
| `facts` | `history 2877, stream 161` | те же (история растёт сама по тикам) |
| `signals` | `review 5184` | без `message` |
| `settings_rows` | `review 1` | `review 1` |

### 3. Функции

```bash
npx supabase functions deploy read-guest-messages
npx supabase functions deploy classify-guest-signals
```

`classify-guest-signals` бандлит изменённый `_shared/signals/classify-run.ts`. Другие функции его не
импортируют, а новые файлы `_shared/signals/message-*.ts` импортирует только `read-guest-messages`.

### 4. `main`

Fast-forward `main` до коммита ветки, затем Vercel Ready. Проверки: `/guests` и `/quality` отвечают
307 на `/login` без входа. Ручная проверка панели — у владельца.

### 5. Слово «включай чаты»

```bash
npx supabase db query --linked -f docs/one-off-writes/guest-chats-on.sql
```

Через 15–30 минут:
- проба: `switch` — `true`, оба задания чтения — `true`;
- раздел «Гости» показывает «Сообщения прочитаны HH:MM»;
- после первых проживаний с жалобой появляются карточки «Из сообщения гостя».

Расход виден в `raw.signal_message_runs`.

## Выключение и откат

- **Выключить:** `guest-chats-off.sql`. Действует сразу: чтение стоит, карточки и столбец «в чатах»
  скрыты, очередь очищена.
- **Стереть метки и карточки:** `guest-chats-labels-wipe.sql`, отдельным словом и только после
  выключения. Сценарий сам отказывает, пока чаты включены.
- **Откат кода** — в обратном порядке:
  1. **Панель:** `git revert` в `main`.
  2. **Функции:** `npx supabase functions delete read-guest-messages`; `classify-guest-signals`
     передеплоить из `282a3fb`.
  3. **База:** `docs/one-off-writes/guest-chats-rollback.sql` через
     `npx supabase db query --linked -f …`, затем
     `npx supabase migration repair --status reverted 20261110120000 --linked`.
     - Только словом владельца и не в 03:00–04:40 UTC.
     - Отрепетировано: после отката наборы `main` (`guest_signals`, `property_quality`,
       `table_grants`, `api_v1`) зелёные, повторный накат проходит.
     - Задания, созданные менеджером из карточек чата, остаются (`source = 'message'`).
     - Журнал расходов остаётся, если что-то потрачено.
