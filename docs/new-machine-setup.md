# Новый главный компьютер

Как перенести работу над STR Ops на другой компьютер Windows и проверить, что
он готов. Написано 2026-10-08 по старому главному компьютеру: версии в таблице
сняты с него. Общая установка проекта — в `README.md` («Требования»,
«Установка», «Локальная разработка»); здесь — то, что нужно сверх неё при
переезде. Ловушки окружения и рецепты стендов — `docs/dev-notes.md`.

Документ публичный: в нём только имена, версии и команды. Значений ключей,
паролей и переменных здесь нет и не должно быть.

## 0. Главное правило переезда

**До конца переезда главный компьютер — один.** Пока новый не прошёл раздел 9,
главный — старый; после — новый, а старый становится пультом: с него только
смотрят и подключаются (раздел 10), но не коммитят, не гоняют тесты и агентов,
не поднимают локальный стек и не запускают `db push`, `eas`, `vercel`.

Почему: ветки, деревья, память Claude Code, замок тестов и журнал сессий живут
на одном компьютере. Две машины, пишущие в одни ветки, расходятся молча, а
`git push` с отстающей копии может затереть чужую работу на `origin`.

Перед переключением на старом: все ветки на `origin`
(`git rev-list --count --branches --not --remotes=origin` даёт `0`), деревья
чистые (`git status` в каждом из `git worktree list`), бандл собран.

## 1. Программы

| Что | Версия на старом компьютере | Заметки |
| --- | --- | --- |
| Windows 11 Pro | 10.0.26200 | Pro нужен для BitLocker и входа по RDP |
| Node.js | 22.13.1 (`.nvmrc`: `22`) | x64, вместе с npm |
| npm | 10.9.2 | |
| Git for Windows | 2.47.1.windows.2 | с Git Bash; `core.longpaths` = `true` (ставит установщик) |
| Docker Desktop | 4.51.0 (Engine 28.5.2, Compose v2.40.3) | бэкенд WSL 2, «Start Docker Desktop when you sign in» |
| WSL | 2.6.1.0, ядро 6.6.87.2-1 | `wsl --install`, затем `wsl --update` |
| Supabase CLI | 2.115.0 | ставится `npm ci` (devDependency), запуск `npx supabase` — отдельно не ставить |
| Deno | 2.9.5 | ставится `npm ci` (devDependency), нужен `npm run test:fn` |
| EAS CLI | 24.12.0 | через `npx eas-cli`; в зависимостях его нет, при расхождении — `npx eas-cli@24.12.0` |
| Vercel CLI | 63.1.0 | через `npx vercel` |
| Claude Code | 2.1.294, канал обновлений `latest` | нативная установка |
| Плагин ECC | `ecc@ecc` 2.2.0 | маркетплейс `ecc` = git `https://github.com/affaan-m/ECC.git` |
| Плагины Vercel и Expo | `vercel@claude-plugins-official` 0.50.0, `expo@claude-plugins-official` 1.13.6 | маркетплейс `claude-plugins-official` |
| Python | 3.12.4 | не обязателен: разовые правки скриптами |
| Google Chrome | — | драйверы puppeteer стенда и живых прогонов |
| adb | — | по необходимости: `winget install --id Google.PlatformTools --exact` (логи падения телефона) |

**MCP.** Своих серверов у проекта нет: ни `.mcp.json` в репозитории, ни
`mcpServers` в `~/.claude.json`. Серверы приходят с плагинами: Vercel
(состояние деплоев, `list_deployments`), Expo и `chrome-devtools` из ECC (на
старом компьютере подключался нестабильно — на него не рассчитывать).
Коннекторы claude.ai приходят с аккаунтом сами.

**Длинные пути.** `git status --ignored` в деревьях упирался в «Filename too
long» внутри `node_modules`. Включить `LongPathsEnabled` (от администратора):
`New-ItemProperty -Path HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem -Name LongPathsEnabled -Value 1 -PropertyType DWORD -Force`.

## 2. «Всегда включён»

Новый компьютер работает и ночью (агенты, длинные прогоны, ночные проверки).
Ночной запуск 25.09 сорвался именно здесь: драйвер Wi-Fi отключил адаптер при
погасшем экране.

- **Сон и гибернация выключены** (PowerShell от администратора):
  `powercfg /change standby-timeout-ac 0`, `powercfg /change hibernate-timeout-ac 0`,
  `powercfg /hibernate off`. Экран гаснуть может.
- **Ноутбук:** закрытая крышка от сети — «ничего не делать»:
  `powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0`, затем
  `powercfg /setactive SCHEME_CURRENT`. Только Modern Standby (S0) — проверить
  `powercfg /a`: такой ноутбук по таймеру сам не просыпается.
- **Windows Update:** Параметры → Windows Update → Дополнительные параметры →
  «Период активности» вручную на рабочие и ночные часы прогонов (до 18 часов);
  на дни выката — «Приостановить обновления».
- **Сеть — кабель**, не Wi-Fi. Если кабеля нет: Диспетчер устройств → адаптер
  Wi-Fi → Управление электропитанием → снять «Разрешить отключение этого
  устройства для экономии энергии».
- **Шифрование диска:** BitLocker (Windows 11 Pro) — Панель управления →
  Шифрование диска BitLocker, проверка `manage-bde -status`. Ключ
  восстановления — в учётную запись Microsoft или на бумагу, не в репозиторий
  и не в бандл.
- **Docker Desktop** — автозапуск при входе; после перезагрузки он поднимает
  весь стек, лёгкий — `npx supabase stop`, затем `npm run db:start:light`.

## 3. Клон — в тот же путь

```powershell
cd $env:USERPROFILE\Desktop
git clone git@github-namorename:Namorename/Cleaning_App_STR.git "Cleaning App"
```

Путь должен совпасть со старым: `C:\Users\Roman\Desktop\Cleaning App`. От него
зависят две вещи:

1. **Память Claude Code** лежит в `%USERPROFILE%\.claude\projects\<имя>\memory\`,
   где `<имя>` — полный путь папки, в котором каждый не буквенно-цифровой
   символ заменён на `-`: `C:\Users\Roman\Desktop\Cleaning App` →
   `C--Users-Roman-Desktop-Cleaning-App`.
2. **Сценарии предполётов** `.claude/workflows/*.js` содержат этот путь
   строками.

**Если путь другой** (другое имя пользователя или диск): один раз запустить
`claude` в новой папке и выйти — в `%USERPROFILE%\.claude\projects\` появится
папка с новым именем. Переложить в неё `memory\` и
`postgrest-upgrade-2026-10-02\` из бандла (или переименовать папку бандла в
новое имя до копирования). Пути в старых сценариях предполётов — это запись
их прогона, их не правят; новые сценарии пишутся с новым путём.

`origin` смотрит на SSH-алиас `github-namorename`. Нужны `~/.ssh/config` с этим
хостом (лежит в бандле, `home/.ssh/config`) и ключ, который он называет
(раздел 5). Проверка: `ssh -T git@github-namorename`.

Деревья `.claude/worktrees/*` не переносятся — их ветки на `origin`. Заводятся
заново: `git worktree add .claude/worktrees/<имя> <ветка>`, затем `npm ci`
внутри дерева (ссылки `node_modules/@str-ops/*` — junction с абсолютным путём,
копия чужого `node_modules` смотрела бы в старое место). Если `git status`
показывает `.claude/worktrees/` неотслеживаемым, дописать строку
`**/.claude/worktrees/` в `.git/info/exclude`.

## 4. Папка migration-bundle

Бандл собран на старом компьютере (`Desktop\migration-bundle`), в git его нет.
Внутри — `README.md` с таблицей «папка бандла → куда класть» и списком того,
что не скопировано. Порядок:

1. Перенести папку, проверить целостность из Git Bash:
   `cd migration-bundle && sha256sum -c SHA256SUMS` — все строки `OK`.
2. Разложить по таблице в его `README.md`. Обязательно:
   - `repo-ignored/.claude/settings.local.json` → `.claude/settings.local.json`
     клона. В нём правила разрешений и **хук пинов**
     (`.claude/hooks/script-pins.mjs` перед каждым Bash/PowerShell): без файла
     `cloud-read.mjs` и `hostaway-get.mjs` не запускаются без вопроса, а пины не
     сверяются.
   - `repo-ignored/supabase/.temp/` → `supabase/.temp/` (привязка CLI к облачному
     проекту), `repo-ignored/apps/web/.vercel/` → `apps/web/.vercel/` (привязка
     Vercel CLI).
   - `claude-memory/` → папка памяти (раздел 3), `claude-session-data/` →
     `%USERPROFILE%\.claude\session-data\`.
   - `scratchpad-tools/` → постоянная папка вне репозитория; в `cycle.sh` и
     `app_cycle.sh` поправить пути (`S`, `LOCK`, `TREE`).
3. Секретов в бандле нет — их владелец переносит отдельно (раздел 5).

## 5. Входы и секреты — владелец, в своём PowerShell

Команды с меню и входом в браузере не идут через `!` в сессии Claude: у
инструментов нет терминала, и `eas-cli` падает на первом вопросе. Всё ниже —
в своём окне PowerShell или Windows Terminal, из папки репозитория.

1. **Файлы секретов** — перенести самому (имена и пути — в `README.md` бандла,
   раздел «Секреты»): `.env`, `apps/mobile/.env`, `apps/web/.env.local`,
   `supabase/functions/.env`. Образцы имён — `.env.example`,
   `apps/web/.env.example`.
2. **GitHub:** SSH-ключ для алиаса — перенести или выпустить новый
   (`ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\<имя ключа из config>`) и
   добавить публичную часть в GitHub; проверка `ssh -T git@github-namorename`.
3. **Supabase:** `npx supabase login` (браузер; токен ляжет в Credential
   Manager как `Supabase CLI:supabase`). Если `supabase/.temp` не перенесён —
   `npx supabase link --project-ref <ref из README.md>`.
4. **EAS:** `cd apps/mobile`, `npx eas-cli login`, проверка `npx eas-cli whoami`.
5. **Vercel:** `npx vercel login`; без `apps/web/.vercel/` из бандла —
   `npx vercel link --cwd apps/web` (проект `cleaning-app-str-web`).
   `VERCEL_OIDC_TOKEN` в `apps/web/.env.local` короткоживущий — обновляется
   `npx vercel env pull --cwd apps/web`.
6. **Claude Code:** `claude`, затем `/login`. Плагины: `/plugin marketplace add
   https://github.com/affaan-m/ECC.git`, `/plugin install ecc@ecc`,
   `/plugin install vercel@claude-plugins-official`,
   `/plugin install expo@claude-plugins-official`; проверить версии по таблице
   раздела 1. `claude-user/settings.json` из бандла — образец (модель,
   включённые плагины, маркетплейсы).
7. **Hostaway — только словом владельца.** Токен выпускается один раз:
   `node scripts/hostaway-issue-token.mjs` (берёт `HOSTAWAY_ACCOUNT_ID` и
   `HOSTAWAY_API_KEY` из `.env`, кладёт токен в
   `%USERPROFILE%\.str-ops\hostaway-token.json`, не печатает). На старом
   компьютере токен не выпускался — переносить нечего. Документация Hostaway
   не говорит, отзывает ли новый токен прежние, поэтому без слова не
   выпускать и не перевыпускать (`--replace`).

## 6. Зависимости и локальный стек

```powershell
npm ci                    # корень; ~5 минут
npm run db:start:light    # Docker должен быть запущен; первый старт тянет образы и применяет миграции
npm run db:types          # git diff packages/shared/src/database.types.ts — пусто
```

`db:start:light` — без Studio, логов, почты, realtime, edge-runtime и пулера:
хватает тестам и стенду. Полный стек — `npm run db:start`.

## 7. Полный цикл тестов

По одному тяжёлому прогону за раз (замок `testlock.mjs` из бандла, если идут
агенты). Под нагрузкой два теста панели упираются в 5 секунд — отсюда
`--testTimeout=15000`.

```powershell
npm run test:rls                 # SQL-наборы против локального стека
npm run test:fn                  # Deno: Edge Functions
npm run test:scripts             # node --test: скрипты, пины, hostaway
npm run typecheck:mobile
npm run test -w @str-ops/mobile -- --maxWorkers=2
npm run typecheck:web
npm run lint -w @str-ops/web
npm run test -w @str-ops/web -- --maxWorkers=2 --testTimeout=15000
npm run build:web
```

Аргументы после `--` передаются в jest и vitest только в этой форме: у обёрток
`test:mobile` и `test:web` они достались бы самому npm.

Все зелёные — компьютер собран. Число тестов сравнить с последним прогоном на
старом компьютере (журнал сессии в `claude-session-data/`).

## 8. Что не переносится и создаётся заново

| Что | Как появляется на новом |
| --- | --- |
| Входы CLI: Supabase, EAS, Vercel, GitHub, Claude Code | раздел 5 |
| Токен Hostaway | раздел 5, п. 7 — словом владельца |
| SSH-ключ (если не переносится) | новый ключ + запись в GitHub |
| Превью Vercel | живут в облаке Vercel по веткам; ничего не переносится, нужен только вход |
| Скретчпад сессии | у каждой сессии свой, временный; постоянные инструменты — `scratchpad-tools/` бандла |
| Пароль менеджера стенда | `stand-manager.mjs` создаёт учётку и пишет пароль заново после каждого `db:reset` |
| Данные локального стека | из миграций при первом старте (файла `supabase/seed.sql` в репозитории нет); стенд — `stand-dashboard.sql` из бандла |
| `node_modules`, деревья `.claude/worktrees/*` | `npm ci`, `git worktree add` (раздел 3) |
| Расшифровки старых сессий Claude Code | не переносятся (`/resume` старых разговоров недоступен); сводки — `claude-session-data/` |

Секреты облака (Supabase Edge Function secrets, `EXPO_ACCESS_TOKEN`, переменные
EAS и Vercel) лежат на серверах и переезда не требуют.

## 9. Проверка нового компьютера — только чтение

Ни одна команда ниже ничего не пишет ни в облако, ни в Hostaway, ни в `origin`.

```powershell
git status                       # чисто
git fetch --all --prune
git log -1 --oneline origin/main
git worktree list

node scripts/cloud-read.mjs docs/rollout/remote_head.sql   # голова миграций облака
npx supabase migration list --linked                       # у всех локальных есть remote
node scripts/hostaway-get.mjs listings --count             # только после выпуска токена

npx vercel ls --cwd apps/web
cd apps/mobile; npx eas-cli update:list --branch preview --limit 1 --json --non-interactive; cd ..
```

Что должно получиться:

- `cloud-read.mjs` в сессии Claude запускается **без вопроса**: значит,
  `settings.local.json` на месте и пины совпали. Вопрос о запуске — признак, что
  хук не нашёл файл или хэш разошёлся (переводы строк: `git ls-files --eol
  scripts/cloud-read.mjs` должен дать `i/lf w/lf`).
- голова облака совпадает с последним файлом `supabase/migrations/`, который
  уже выкачен (по `migration list --linked`);
- `hostaway-get.mjs` отвечает числом, а не `401`.

## 10. Пульт: Remote Control со старого компьютера

На новом компьютере, в папке репозитория:

```powershell
claude remote-control --name str-ops-main
```

Сессию видно на claude.ai/code и в мобильном приложении Claude; со старого компьютера —
открыть claude.ai/code в браузере и выбрать её. Вернуться к той же сессии после
обрыва — `claude remote-control --continue` (запись живёт около 4 часов).

Что через пульт не делается: `/ultrareview` (только из терминала), команды
`eas` с меню и входом и всё из раздела 5 — для них нужно окно на самом новом
компьютере (сесть за него или зайти по RDP: Windows 11 Pro → Параметры →
Система → Удалённый рабочий стол).
