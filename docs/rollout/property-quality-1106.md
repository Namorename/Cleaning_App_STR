# Качество объектов: выкат

Этапы 1–2 `docs/property-intelligence-plan.md`. Ветка `property-quality-1106` от `main` `289db3c`.
Ни один шаг не выполнялся: в облаке нет ни миграции, ни функции, панель в `main` не влита. Каждый шаг
идёт только по слову владельца, ниже названо какому. Ни один шаг не идёт в окне 03:00–04:40 UTC.

Телефон и OTA не нужны. API не меняется. Уже выкаченные функции не передеплоиваются: в `hostaway.ts`
добавились только три слова `export`, поведение то же.

## Порядок и слова

| Шаг | Слово владельца | Что произойдёт | Условие |
|---|---|---|---|
| 1 | **«применяй миграцию качества»** | Охраняемый `db push` одной миграции, потом проба | Голова облака `20261104200000` |
| 2 | **«деплой функции истории»** | `npx supabase functions deploy read-signal-history` | После шага 1 |
| 3 | **«выкатывай панель качества»** | Fast-forward `main`, `git push origin main`: это прод-деплой Vercel | После шага 1 |
| 4 | **«включай словарь заданий»** | Активное задание 06:40 UTC и один прогон сейчас: темы заданий, эпизоды из находок | После шага 1 |
| 5 | **«запускай историю»** | `history_enabled`, дневной лимит 1 500, тик каждые 10 минут | После шагов 1, 2 и пробы точности |
| Стоп | **«стоп истории»** | Выключает чтение, метки остаются | В любой момент |

Шаги 3 и 4 не зависят друг от друга и от шага 2. До шага 4 раздел честно показывает оценки и пустые
темы. До шага 5 в длинных окнах нет заездов, и раздел говорит об этом.

## Шаг 1. Миграция

Из дерева ветки. В `supabase/.temp` дерева должен быть `pooler-url`: скопировать из корня репозитория
(`cp -n`), без него `--linked` не работает. Застава неотделима от push: CLI в этой среде подтверждения
не спрашивает (`CLAUDE.md`).

```bash
HEAD_WANT=20261104200000
LIST_WANT="20261106120000_property_quality.sql"
SHA_WANT=@@SHA@@
[ "$(sha256sum supabase/migrations/20261106120000_property_quality.sql | cut -d' ' -f1)" = "$SHA_WANT" ] &&
[ "$(node scripts/cloud-read.mjs docs/rollout/remote_head.sql |
     node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(String(JSON.parse(s)[0].head))}catch{}})")" = "$HEAD_WANT" ] &&
[ "$(npx supabase db push --linked --skip-vault --dry-run --output-format json |
     node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(JSON.parse(s).migrations.join(' '))}catch{}})")" = "$LIST_WANT" ] &&
npx supabase db push --linked --skip-vault
```

Сухой прогон обязан назвать ровно одну миграцию. Если застава закрылась, push не идёт: разбираться, а
не обходить. У вызова Bash `timeout` 600000.

**Проба после:** `node scripts/cloud-read.mjs docs/rollout/postpush_property_quality_1106.sql`.

| Поле | Должно быть |
|---|---|
| `head` | `20261106120000` |
| `tables` | 6 таблиц |
| `settings` | `history_enabled` false, `history_daily_cap` 0, `history_budget_micro_usd` 5000000, `history_depth_months` 12, `history_include_private` false |
| `jobs` | 2 задания, оба `active=false` |
| `client_grants`, `raw_grants` | Пусто. Хостинг раздаёт новым таблицам больше локального стека: непустое — стоп и `revoke` |
| `exec` | Только `quality_overview authenticated`, `quality_place authenticated` |
| `line_bodies` | `review_load_state` `7a02bc4a`, `review_text_allowed` `1d073853`, `store_review_texts` `0e8ea5b2`: граница текстов не тронута |

Вторая проба, только после push: `node scripts/cloud-read.mjs docs/rollout/postpush_property_quality_counts_1106.sql`.
Должно быть `themes` 35, остальное 0.

Старая панель с новой базой работает как раньше: миграция только добавляет.

## Шаг 2. Функция

```bash
npx supabase functions deploy read-signal-history
```

`verify_jwt` как у `sync-guest-signals`: вызывает планировщик с сервисным ключом. Секреты уже стоят:
`GUEST_SIGNAL_KEY_SECRET`, `ANTHROPIC_API_KEY`, ключи Hostaway. Секрет ключей не перезаписывается.
Функция выкатывается выключенной: пока `history_enabled` выключен, она ничего не читает.

**Проба после:** `npx supabase functions list` показывает функцию ACTIVE. Ручной вызов не нужен.

## Шаг 3. Панель

Перед шагом: `npx supabase migration list --linked` показывает `20261106120000` в облаке.

```bash
git switch main && git merge --ff-only property-quality-1106 && git push origin main
```

Vercel выкатывает сам. Проба: сборка Ready, `/quality` открывается у менеджера, закрыта у главного
техника.

## Шаг 4. Словарь заданий

```bash
npx supabase db query --linked -f docs/one-off-writes/property-quality-refresh-on.sql
```

Проба: `problem_themes` больше 0 в пробе счётчиков, в `jobs` задание `refresh-property-quality` `active=true`.

## Шаг 5. История

Только после пробы точности. Рекомендуемая вторая ограда — разовый лимит $5 на ключ в консоли Anthropic.

```bash
npx supabase db query --linked -f docs/one-off-writes/property-quality-history-on.sql
```

Что должно произойти: тик раз в 10 минут, неделя отзывов и месяц заездов за запуск, 4 054 отзыва за три
дня, около $1. Заезды прошлых месяцев подтянутся за первые два часа. Последние четыре недели до границы
дозреют к 04.12: так задумано, у Booking отзыв приходит до 27 дней.

**Смотреть:** `weeks_done`, `attempts_failed` и `spent_micro_usd` пробой счётчиков, только чтение. Стоп:

```bash
npx supabase db query --linked -f docs/one-off-writes/property-quality-history-off.sql
```

## Откат

| Что | Как | Слово |
|---|---|---|
| Остановить чтение, метки оставить | `property-quality-history-off.sql` | «стоп истории» |
| Стереть метки истории, схема остаётся | `property-quality-labels-wipe.sql`. Деньги не возвращаются в лимит: журнал сохраняет расход, недели открываются заново | «стирай метки истории» |
| Убрать панель | `git revert` слияния в `main`, push | «откати панель качества» |
| Убрать всё | Сначала панель, затем `property-quality-rollback.sql`, `migration repair --status reverted 20261106120000 --linked`, `functions delete read-signal-history`, проба. Журнал с расходом остаётся, если чтение что-то потратило: лимит $5 откатом не возвращается | «откатывай качество целиком» |

Тексты стирать не нужно ни в одном случае: история их не хранит. Тексты потока с 02.11 откат не трогает.

## Репетиция

На временной базе `rehearsal_pq_b` в контейнере локального стека, общий стенд не тронут. Сценарий —
`docs/rollout/rehearsal-db-1030.mjs` ветки `rollout-plan-1028`.

1. База на голове облака: 120 миграций, отпечаток каталога снят.
2. Проба до: `head` `20261104200000`, новых объектов нет.
3. Миграция применена. Проба после: всё по таблице шага 1.
4. Посев, `property-quality-labels-wipe.sql`: меток истории 0, эпизоды потока на месте, переключатели
   выключены, недели открыты, расход сохранён.
5. `property-quality-rollback.sql` на базе с журналом: журнал остался, расход цел.
6. Журнал очищен, откат на чистой базе: отпечаток равен снятому на шаге 1.
7. Миграция применена повторно, набор `property_quality.sql` зелёный.
