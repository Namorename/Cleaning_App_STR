# Кто выполнил и кто закрыл задание — выкат 09.11

Срочная правка владельца 09.11. В «Заданиях» видно, кто выполнил и кто закрыл: доска, таблица,
архив и страница панели, экран задания и доска главного техника на телефоне, API v1 и MCP.
Диалог закрытия спрашивает «Кто выполнил». Слова владельца на облачные шаги даны в самой задаче:
одна охраняемая миграция, функции — только изменённые, `main` — fast-forward, OTA — только
preview (Android); field — только по «публикуй field». Окно 03:00–04:40 UTC не задевать.

## Что едет

| Часть | Что | Как проверено |
|---|---|---|
| Миграция | `20261106125000_problem_closing.sql`, sha256 `31435debdfc33f9ab90d124ae2bbab4db44aa2ad96b3e3cc41afadd3db986e29` | `db:reset`, `supabase/tests/problem_closing.sql`, проверка в `api_v1.sql`, репетиция на временной базе |
| Edge Functions | Нет. Код `api` и `mcp` не менялся: тело задания строит SQL, MCP отдаёт ответ API как есть, `catalog.ts` после `api:docs` тот же | `git diff -- supabase/functions` пуст |
| Панель | `main` fast-forward, Vercel | tsc, eslint, vitest, сборка |
| Телефон | OTA preview (Android), поверх №14 | tsc, jest, сверка бандла |

Дата миграции стоит раньше частей этапа 4 (`20261106130000` и дальше): они ждут в своих ветках и
лягут после неё без новых дат.

## Миграция

Только добавляет: пять колонок `problems` без внешних ключей, триггер отметки, новую подпись
`resolve_problem(uuid, uuid, boolean)` (старый вызов `{p_id}` попадает в неё и закрывает как
раньше, с «не указано»), вычисляемое поле `closing_people`, поля задания в API v1 и правку
`analytics_problems_by_technician`. Бэкфилл пишет только новые колонки; `problems_touch`
выключен на время бэкфилла, поэтому `updated_at` не двигается. Блокировка `problems` —
миллисекунды (`lock_timeout` 5 с); чтение истории отзывов `problems` не пишет.

### Застава и push

Одной командой, в минуту, далёкую от тика чтения истории (тик в :00, :10, …):

```bash
HEAD_WANT=20261106120000
LIST_WANT="20261106125000_problem_closing.sql"
SHA_WANT=31435debdfc33f9ab90d124ae2bbab4db44aa2ad96b3e3cc41afadd3db986e29
[ "$(sha256sum supabase/migrations/20261106125000_problem_closing.sql | cut -d' ' -f1)" = "$SHA_WANT" ] &&
[ "$(node scripts/cloud-read.mjs docs/rollout/remote_head.sql |
     node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(String(JSON.parse(s)[0].head))}catch{}})")" = "$HEAD_WANT" ] &&
[ "$(npx supabase db push --linked --skip-vault --dry-run --output-format json |
     node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(JSON.parse(s).migrations.join(' '))}catch{}})")" = "$LIST_WANT" ] &&
npx supabase db push --linked --skip-vault
```

### Проба до и после

`node scripts/cloud-read.mjs docs/rollout/postpush_problem_closing_1109.sql`

| Поле | До (09.11, 14:00 UTC) | После |
|---|---|---|
| `head` | `20261106120000` | `20261106125000` |
| `columns` | пусто | пять колонок |
| `triggers` | четыре, все `O` | плюс `problems_stamp_closing=O`; `problems_touch=O` |
| `exec` | `resolve_problem(uuid)` authenticated, service_role | `resolve_problem(uuid,uuid,boolean)` authenticated, service_role; `closing_people` без anon; `api_task_json(problems,text[])` и `api_task_person_json` — никому |
| `closing` | `closed:none:no_worker` 202, `open:none:no_worker` 65 | закрытые разнесены по видам: `worker` с исполнителем — столько, сколько техники закрыли своим завершением (134 на 14:30), остальные закрытые — `manager` без исполнителя |
| `kept` | `c36f687edb635d50a84362162d97d171` | тот же (в тот же день UTC) |

Ожидание взято из журнала облака 09.11: выполненные техник закрыл своим завершением в той же
записи (134 на 14:30, у всех время попытки = время записи журнала), остальные выполненные,
39 отменённых и 4 архивных закрыл менеджер; журнал есть у всех закрытых. Исполнитель берётся
только из попытки, завершённой в той же записи, что закрыла задание: круг до переоткрытия и
запись журнала без автора дают «не указано».

## Метрики

Аналитика «Задания по техникам» (и её CSV, XLSX, PDF — те же функции): задание, которое менеджер
закрыл за сотрудника, засчитано сотруднику в штуках, но без времени работы и времени решения;
закрытое «Никто, менеджер сам» не засчитано никому. Пометка — под таблицей и в «Как считаются
цифры» PDF. Прошлое не меняется: эти две отметки ставит только новый диалог.

## Откат — в обратном порядке

1. Телефон: `update:republish --group 51712e63-9d2e-4575-8a90-f6e9dd4f991a --destination-branch preview`
   (№14) из `apps/mobile`. Новый бандл читает колонки, которых после отката базы не будет.
2. Панель: `git revert` коммитов правки в `main` (Vercel выкатит сам).
3. База: `docs/one-off-writes/problem-closing-rollback.sql` и
   `npx supabase migration repair --status reverted 20261106125000 --linked` — только словом
   владельца, не в 03:00–04:40 UTC. Отрепетировано: колонок, триггера и новых функций не
   остаётся, `resolve_problem(uuid)` с прежними правами, статусы и даты не сдвигаются.
