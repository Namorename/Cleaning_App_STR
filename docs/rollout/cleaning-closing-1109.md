# Кто выполнил и кто закрыл уборку — выкат 09.11

Вторая срочная правка владельца 09.11, по образцу «Заданий» (`problem-closing-1109.md`). В «Уборках»
видно, кто выполнил, кто отменил и почему уборка не состоялась; менеджер закрывает уборку с полем
«Кто выполнил»; у выполненной уборки и задания с «не указано» исполнителя можно указать постфактум.
Слова владельца на облачные шаги даны в задаче: одна охраняемая миграция, функции — только
изменённые, `main` — fast-forward, OTA — только preview, field — только по «публикуй field».

## Что едет

| Часть | Что | Как проверено |
|---|---|---|
| Миграция | `20261106125500_cleaning_closing.sql`, sha256 `ae1e99faab4d83403eea0d5c4a5b068cf29b0535183fb3afc2fa34bd6642fa54` | `db:reset`, `supabase/tests/cleaning_closing.sql`, матрица прав, репетиция на временной базе |
| Edge Functions | Нет: тело уборки строит SQL, MCP проксирует; `catalog.ts` тот же | `git diff -- supabase/functions` — только контрактный тест |
| Панель | `main` fast-forward, Vercel | tsc, eslint, vitest, сборка |
| Телефон | OTA preview поверх №15 | tsc, jest, сверка бандла |

## Миграция

Только добавляет: таблицу `task_closings` (кто выполнил, источник, кто закрыл, как, почему, когда),
журнал ручных отметок `closing_marks`, триггер `tasks_stamp_closing` (после журнала, берёт его
причину), `complete_cleaning`, `name_cleaning_worker`, `name_problem_worker`, вычисляемое поле
`task_closing`, источник исполнителя `problems.completed_by_source`, поля уборки в API v1, правку
аналитики горничных. Бэкфилл уборок — только вставки в новую таблицу: ни одна строка `tasks` не
меняется (ни `updated_at`, ни триггеры, ни push). Бэкфилл заданий пишет только новую колонку при
выключенном `problems_touch`.

### Застава и push

```bash
HEAD_WANT=20261106125000
LIST_WANT="20261106125500_cleaning_closing.sql"
SHA_WANT=ae1e99faab4d83403eea0d5c4a5b068cf29b0535183fb3afc2fa34bd6642fa54
[ "$(sha256sum supabase/migrations/20261106125500_cleaning_closing.sql | cut -d' ' -f1)" = "$SHA_WANT" ] &&
[ "$(node scripts/cloud-read.mjs docs/rollout/remote_head.sql |
     node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(String(JSON.parse(s)[0].head))}catch{}})")" = "$HEAD_WANT" ] &&
[ "$(npx supabase db push --linked --skip-vault --dry-run --output-format json |
     node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(JSON.parse(s).migrations.join(' '))}catch{}})")" = "$LIST_WANT" ] &&
npx supabase db push --linked --skip-vault
```

### Пробы

`node scripts/cloud-read.mjs docs/rollout/postpush_cleaning_closing_1109.sql`

| Поле | До (09.11, 15:38 UTC) | После |
|---|---|---|
| `head` | `20261106125000` | `20261106125500` |
| `tables` | пусто | `closing_marks`, `task_closings` |
| `grants` | пусто | только `authenticated SELECT` на обе |
| `trigger` | пусто | `tasks_stamp_closing=O` |
| `exec` | `api_cleaning_json(tasks) -` | новые функции без anon; помощники API — никому |
| `sources` | `none` 161 | `recorded` — бывшие с исполнителем, остальные `none` |
| `kept` | `9ad78a5afeddea8ade309689b7d7fdce` | тот же (в тот же день UTC) |

После push — `postpush_cleaning_closing_counts_1109.sql`: закрытые уборки по статусу, способу,
причине и источникам; `orphans` = 0. Ожидание по журналу облака 09.11: выполненные — `worker`,
источник `recorded` (все завершила сама горничная); «не состоялась» — `auto night_pass recorded`;
отменённые с журналом — `auto booking_*`; 212 отменённых до журнала (16.10) — `none`, «не указано».

## Метрики горничных

Уборка, закрытая менеджером за горничную, засчитана ей в штуках, но не входит в минуты и долю с
фото; закрытая «Никто, менеджер сам» — ничья. Пометка под таблицей и в PDF. Прошлое не меняется:
эти отметки ставит только новый диалог. Ручная отметка постфактум не трогает `tasks.completed_by`,
поэтому прошлые метрики периодов не меняются.

## Откат — в обратном порядке

1. Телефон: `update:republish --group f4c46683-e6e9-4322-949d-112113226427 --destination-branch preview`
   (№15) из `apps/mobile`.
2. Панель: `git revert` коммита правки в `main`.
3. База: `docs/one-off-writes/cleaning-closing-rollback.sql` и
   `npx supabase migration repair --status reverted 20261106125500 --linked` — только словом
   владельца, не в 03:00–04:40 UTC. Отрепетировано: таблиц, колонки, триггера и новых функций не
   остаётся, строки уборок не сдвигаются.
