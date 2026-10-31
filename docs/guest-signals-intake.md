# Сигналы гостей, этап 2 — приём сообщений без текста

2026-10-31, ветка `guest-signals-intake-1031` от `origin/main` (`8087f14`). Решения владельца 31.10 —
`docs/guest-signals.md` §10 (ветка `guest-signals-design-1031`): 3 — текст сообщений не храним; 4 — тела
вырезаем при приёме, уже лежащие стираем **только по отдельному слову владельца**. Ничего не выкачено:
функция не задеплоена, очистка не выполнялась, в облако ничего не писалось.

## 1. Что изменено

| Файл | Что |
|---|---|
| `supabase/functions/hostaway-webhook/guest-message.ts` | новый: какие поля сообщения хранит журнал; распознавание события сообщения; урезание; неразобранное тело, похожее на сообщение, — только длина |
| `supabase/functions/hostaway-webhook/handler.ts` | разобранное тело проходит `journalPayload`, неразобранное — `journalUnparsed`; коды ответов не менялись; русские комментарии переведены (правило CLAUDE.md) |
| `supabase/functions/hostaway-webhook/guest-message.test.ts` | новый: 14 тестов |
| `supabase/functions/hostaway-webhook/handler.test.ts` | +3 теста (сообщение, бронь с данными гостя, неразобранное сообщение); названия и комментарии переведены |
| `docs/one-off-writes/guest-message-bodies-wipe.sql` | новый: разовая очистка уже лежащих текстов — **не выполнялась** |
| `docs/rollout/guest_message_intake_probe.sql` | новый: проба, только чтение, только числа и время |

**Что хранится у события сообщения** (`object = conversationMessage`, `event = message.received`; распознаётся
по `object` с «message» или `event`, начинающемуся на «message» / «conversation»):

| Уровень | Ключи | Зачем |
|---|---|---|
| верх | `object`, `event`, `objectId`, `accountId` | тип события; `objectId` — у старой формы вебхука; `accountId` — какой аккаунт Hostaway прислал (понадобится, когда у компаний будут свои аккаунты) |
| `data` | `id` | id сообщения; из него `record_webhook_event` берёт `object_id` |
| `data` | `isIncoming`, `communicationType`, `channelId` | направление и канал |
| `data` | `conversationId`, `reservationId`, `listingMapId` | разговор, бронь, листинг |
| `data` | `date`, `insertedOn`, `updatedOn`, `sentChannelDate`, `listingTimeZoneName` | времена и часовой пояс, в котором их читать |

Только простые значения (строка, число, логическое, null): вложенный объект или массив под этими ключами не
сохраняется. Всё остальное — `body`, `attachments`, `imagesUrls`, `hash`, имена, почты, телефоны, поля
каналов — не попадает в базу вообще: урезание идёт в функции до вызова `record_webhook_event`. Брони, задания
и неизвестные события хранятся как пришли (тот же объект).

## 2. Деплой и миграция

- **Миграции нет.** `record_webhook_event` читает из нагрузки только `object`, `event`, `objectId` и
  `data.id` — всё это остаётся. Схема, гранты, cron не меняются; заставы голова + сухой прогон не нужны,
  нумерация шага 5 не задета.
- **Нужен деплой одной функции — `hostaway-webhook`.** Общий код `_shared/` не менялся, новый модуль лежит в
  папке функции — другие функции передеплоивать не нужно.
- Клиенты не меняются: ни OTA, ни сборки; `apps/web` не затронут (коммит в `main` не пересобирает панель).

## 3. Проверки

| Проверка | Итог |
|---|---|
| `deno test --allow-read supabase/functions/hostaway-webhook/` | 30 / 30 |
| `deno test --allow-read supabase/functions/` (весь `test:fn`) | 317 / 317 |
| `deno lint supabase/functions/hostaway-webhook/` | 3 замечания `no-import-prefix` на строках `jsr:` — как у всех функций проекта |
| `test:scripts` (в том числе страж `cloud-read` для новой пробы) | 70 / 70 |
| очистка на локальном стенде, в транзакции с откатом: 8 синтетических строк через `record_webhook_event`, файл очистки как есть, сравнение с `guest-message.ts` | 8 / 8 совпали; повторный прогон — 0 строк; бронь не тронута; на стенде после отката 0 строк |
| списки полей и проверки в двух SQL-файлах = `guest-message.ts` | тест в `guest-message.test.ts` |
| проба в облаке до выката (31.10, 13:38 UTC) | ниже, §5 |

## 4. Порядок выката

Все шаги — только словом владельца. Окно 03:00–04:40 UTC обходить (очистка журнала в 03:50).

**2a. Деплой функции** (слово «деплой приёма»), из корня дерева `guest-signals-intake-1031`:

```bash
node scripts/cloud-read.mjs docs/rollout/guest_message_intake_probe.sql   # до: как в §5, «до деплоя»
npx supabase functions deploy hostaway-webhook                             # verify_jwt = false из config.toml
```

**2b. Проверка.** Сообщение гостя приходит в среднем раз в 10 минут (136 в сутки), ночью реже:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST "https://<project-ref>.supabase.co/functions/v1/hostaway-webhook"   # 401: функция жива, ничего не записано
node scripts/cloud-read.mjs docs/rollout/guest_message_intake_probe.sql
```

Ожидается: `first_minimal_at` позже времени деплоя, `minimal_events` ≥ 1, `last_not_minimal_at` раньше
деплоя, `reservation_last_24h` — только `processed`. Брони — по суточной сверке, как обычно.

**2c. `main`** (слово): `git push origin HEAD:main` из этого дерева — fast-forward от `8087f14`, если
`main` не ушёл вперёд; иначе слияние. Панель не пересобирается (нет `apps/web`).

**2d. Очистка уже лежащих текстов** (отдельное слово владельца, решение 4), после 2b:

```bash
node scripts/cloud-read.mjs docs/rollout/guest_message_intake_probe.sql                    # до
npx supabase db query --linked -f docs/one-off-writes/guest-message-bodies-wipe.sql      # один оператор
node scripts/cloud-read.mjs docs/rollout/guest_message_intake_probe.sql                    # после
```

Ответ очистки: `message_events` = всё в журнале, `with_body_before` = `to_wipe` = `wiped` = число строк с
текстом, `text_left_in_wiped` 0, `reservation_rows` — как в пробе до. **Отката нет**: тексты удаляются
насовсем; если какой-то понадобится, он читается из Hostaway заново —
`GET conversations/{data.conversationId}/messages`.

Без 2d лежащие тексты уйдут сами: журнал удаляет обработанные и пропущенные события старше 30 дней — последнее
событие с текстом исчезнет примерно через 30 дней после деплоя.

## 5. Ожидаемые числа пробы

| Метка | До деплоя (31.10, 13:38 UTC — прочитано) | После 2a | После 2d |
|---|---|---|---|
| `message_events` | **4 116** | +≈ 137 в сутки, − очистка старше 30 дней | так же |
| `not_minimal` | 4 116 | не растёт, убывает с очисткой | **0** |
| `with_body` | 4 116 | не растёт | **0** |
| `minimal_events` | 0 | растёт с каждым сообщением | = `message_events` |
| `last_not_minimal_at` | 2026-10-31 13:06 UTC | раньше деплоя | null |
| `first_minimal_at` | null | сразу после деплоя | самое старое событие |
| `message_status` | `skipped` 4 116 | `skipped` (+ `pending` на один прогон) | так же |
| `unparsed` | 0 / 0 | `withheld` растёт, только если придёт неразобранное сообщение | `kept_text` 0 |
| `reservation_last_24h` | `processed` 177 | только `processed` | так же |

**Сейчас лежит с текстом: 4 116 событий сообщений** (1–31.10, все `skipped`), из них 3 954 с непустым
текстом; неразобранных тел 0.

## 6. Откат изменения кода

```bash
# дерево на коммите до этапа 2 (8087f14 или main до слияния):
git worktree add ../intake-rollback 8087f14 && cd ../intake-rollback
cp "<корень>/supabase/.temp/project-ref" supabase/.temp/      # связка проекта, как для любого дерева
npx supabase functions deploy hostaway-webhook
```

После отката новые сообщения снова пишутся с текстом; уже урезанные строки не восстанавливаются (это и не
нужно). В `main` — `git revert` коммита этапа (только словом). Очистка 2d отката не имеет (§4).

## 7. Кто читает тексты сообщений — никто

- **База** (облако, проба 31.10): `raw.webhook_events` упоминают три функции — `record_webhook_event`
  (пишет), `claim_webhook_events` (забирает id, тип, `object_id`, попытки), `mark_webhook_events` (статус);
  ни одна не обращается к `body`. Представлений над таблицей нет. Из cron — только
  `process-webhook-events` и `purge-webhook-events`. Схема `raw` не выставлена через PostgREST.
- **Код** (поиск по всему репозиторию): `process-webhook-events` получает из `claim_webhook_events` только
  `id`, `object_type`, `object_id`, `event_type`, `attempts` и разбирает только `reservation`, всё прочее
  помечает `skipped`; брони перечитывает из Hostaway, тело события не читает. Панель, телефон, скрипты — ни
  одной ссылки на `webhook_events`. Пробы в `docs/rollout` считают строки и статусы, не нагрузку. Ветка
  отзывов журнал вебхуков не читает (отзывы берутся опросом API).
- **Разово, при исследовании 31.10** (`docs/guest-signals.md` §11) тексты читались один раз: из облака
  конвейером в локальный счётчик в памяти, наружу — только числа. Это было не в коде и не повторяется.

## 8. Обработка броней не изменилась

- Для событий не о сообщениях `journalPayload` возвращает тот же объект (тест `assertStrictEquals`), бронь с
  именем и почтой гостя пишется целиком (тест в `handler.test.ts`).
- `record_webhook_event`, `claim_webhook_events`, `mark_webhook_events`, `process-webhook-events`, cron —
  не тронуты (дифф ветки — только папка `hostaway-webhook` и два SQL-файла в `docs`).
- После деплоя проба `reservation_last_24h` должна показывать только `processed`, как до (177 за сутки на
  31.10).
