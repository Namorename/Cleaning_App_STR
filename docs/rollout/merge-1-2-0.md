# Слияния 1.2.0 в `main` — подготовка (не выполнено)

**Составлено 2026-10-09 ночью.** Ничего из этого не сделано: push в `main` — прод-деплой панели
(Vercel), он только по слову владельца. Здесь — что каждое слияние заденет, проверка на слитом дереве и
точные команды. Порядок: сначала телефон, потом панель, потом страница `/privacy`.

## 1. `phone-1-2-0` → `main`

**Когда.** По слову владельца, после проверки APK 1.2.0 на его телефоне (ветка влита коммитом
«натив + 1.2.0»). Сборка 1.2.0 идёт с `dab5237`, слияние — с головы ветки; всё после `dab5237` —
JavaScript, нативная проверка против `dab5237` пуста.

**Что заденет панель** (`git diff origin/main <голова> -- apps/web packages/shared`, 12 файлов):
- `apps/web/src/lib/search.ts` — поиск переехал в `packages/shared/src/search.ts`, в панели остался
  реэкспорт; код тот же.
- `apps/web/src/lib/supabase/client.ts` и два его теста — повтор запроса после 401 «JWT issued at
  future» берётся из `packages/shared/src/supabase/stale-clock-retry.ts` (ветка `mobile-401-retry`);
  поведение панели то же.
- `packages/shared`: `design/icons.ts` (+`action.hidePassword`, `action.send`), `design/status.ts`
  (комментарий), `index.ts` (экспорты), `search.ts`, `supabase/stale-clock-retry.ts`.
- Общие тексты: ru +181, en +177, cs +181 ключ (разница — формы множественного числа), 8 удалено
  (`steps.pickVideo`, `steps.videoTooLong`, 6 ключей старого выбора расходника), 4 изменено
  (`auth.heading`, три подписи расходников). **Ни одного ключа `panel.*`**, и ни один удалённый или
  изменённый ключ панель не читает (поиск по `apps/web/src` на `main`).
- `package-lock.json` — пакеты телефона (`react-native-svg`, `lucide-react-native` и др.); Vercel
  ставит из корня, панели они не нужны.

**Выкат панели — будет.** Коммит трогает `apps/web` и `packages/shared`, Vercel соберёт прод. Видимых
изменений в панели нет. После — `curl -I <прод>/login` → 200, `/dashboard` → 307 на вход.

**Схема.** Ветка не трогает `supabase/`: `db push` не нужен. Всё, что читает телефон 1.2.0
(`hosts.video_*`, `problem_events`, `unassign_problem(p_task_id, p_expected_assignee)`), в облаке с
03–08.10, голова `20261008100000`.

**Проверка на слитом дереве** (локальная ветка `merge-check-1-2-0` в
`.claude/worktrees/merge-main-1-2-0`, `origin/main` + `--no-ff` голова телефона, не запушена):
телефон `8a58d77` (2026-10-09): телефон — tsc 0, `expo lint` 0 ошибок (3 старых предупреждения), jest 182 файла / 2913 тестов; панель — tsc 0, eslint 0, vitest 114 файлов / 1308 тестов, `next build` ок. Журнал — `~/dev-tools/str-ops/night-1009/c6-merge-main`. Если ветка уйдёт дальше — повторить.

**Команды (по слову владельца, мои):**
```bash
git fetch origin
git switch -c merge-main-1-2-0-final origin/main
git merge --no-ff origin/phone-1-2-0 -m "merge: phone-1-2-0 - redesign, video, technicians, native 1.2.0"
# цикл: телефон tsc, lint, jest; панель tsc, eslint, vitest, next build — через замок
git push origin HEAD:main        # прод панели; Vercel READY, /login 200, /dashboard 307
```
После этого `eas update` можно делать и из `main` (схема в облаке), но только по слову владельца и
сначала на `preview` (`docs/ios-launch-checklist.md`, раздел 6).

## 2. `panel-video-tech` → `main` — после того, как телефон владельца на 1.2.0

**Что внутри** (11 коммитов, 43 файла `apps/web` + общие тексты): плеер видео в ящике уборки и
шагах ремонта; «Настройки → Процесс → Видео» (три числа, пресеты Free/Pro); подсказка предела компании
в редакторе процесса; главный техник в «Команде». Тексты: +30 ключей, изменён один —
`panel.settings.workflow.limitsHint`; телефон их не читает. `supabase/` и `apps/mobile` не тронуты.

**Почему не раньше.** Форма видео обещает то, что умеет только 1.2.0 (запись своей камерой, битрейт,
предел файла); телефон 1.1.0 режет видео по своим 30 с. Владелец назначил условие: его телефон на 1.2.0.
Горничные на 1.1.0 до раздачи `field` всё ещё пишут по-старому — это стоит помнить, меняя числа.

**Конфликты.** Нет ни с `main`, ни поверх слитого телефона (`git merge-tree`).

**Выкат панели — будет** (прод).

**Проверка на слитом дереве** (`main` + телефон + `panel-video-tech`):
ветка `merge-check-panel` в том же дереве (2026-10-09): панель — tsc 0, eslint 0, vitest 123 файла / 1427 тестов, `next build` ок; телефон — tsc 0, тесты переводов и констант 7 файлов / 655 тестов (тексты общие). Журнал — `c7-merge-panel`.

**Команды:** как в разделе 1, `git merge --no-ff origin/panel-video-tech` поверх уже обновлённого `main`.

## 3. `privacy-page` → `main` — после того, как владелец впишет реквизиты

Ветка от `origin/main` (`9bcfab3`), 3 коммита, превью Vercel собрано. Страница `/privacy` открыта без
входа (`proxy.ts`, ровно этот путь), чешский по умолчанию, `?lang=en|ru`. Реквизиты оператора — в
серверных переменных Vercel `PRIVACY_OPERATOR_NAME`, `PRIVACY_OPERATOR_ID`, `PRIVACY_OPERATOR_ADDRESS`,
`PRIVACY_CONTACT_EMAIL` (Production и Preview), остальные значения (даты, сроки, регионы, формат
выгрузки) — `apps/web/src/app/privacy/settings.ts`; пока не вписаны — жирные «doplnit / to fill in /
вписать». Как вписать — `docs/privacy-policy-draft.md`, последний раздел. Тексты: +131 ключ в каждом
языке, ничего не удалено. Конфликтов с телефоном и панелью нет. В `main` — только когда ни одного
«doplnit» на странице не осталось; ссылку в App Store Connect давать после этого.
