# Переименование разделов: таблица строк

> Черновик на проверку владельцу, 2026-09-27. Файлы перевода и код не тронуты. Ключи i18n, маршруты `/tasks` и `/problems`, таблицы и функции остаются прежними — меняется только текст, который читает человек.

Решение владельца от 2026-09-27: раздел «Задания» (уборки, осмотры, ремонты — маршрут `/tasks`, на телефоне «Мои задачи») называется «Уборки», включая осмотры и ремонты; раздел «Проблемы» (о них сообщают горничные — маршрут `/problems`) называется «Задания». Везде, где это читает человек: меню и экраны панели, приложение горничной, тексты ошибок — на трёх языках, с формами множественного числа.

Откуда строки. Вход — список из 101 ключа, в тексте которых на одном из языков стоит одно из слов. Свой поиск по трём файлам (корни задан, задач, проблем; task, problem, issue; úkol, úkl, problém — во всех падежах и числах) других ключей со старыми словами не нашёл: все 101 уже во входе. Но поиск не видит слова, которого нет в строке, а род подлежащего живёт и без него: статус «Назначено» согласован с «задание», «Решена» — с «проблема». Поэтому разделы `panel.tasks`, `panel.problems`, `panel.calendar`, `tasks`, `problems`, `steps`, `serverErrors`, `chat` прочитаны целиком: добавлены 22 ключа, где меняется род, и 4 проверенных, которые остаются. Всего в таблице 127 строк: меняются 122, остаются 5.

## 1. Правила и словарь

### Словарь

| что | ru | en | cs |
|---|---|---|---|
| раздел `/tasks` (уборки, осмотры, ремонты) | Задания → **Уборки** | Tasks → **Cleanings** | Úkoly → **Úklidy** |
| вкладка телефона | Мои задачи → **Мои уборки** | My tasks → **My cleanings** | Moje úkoly → **Moje úklidy** |
| одна запись раздела `/tasks` | задание (панель), задача (телефон) → **уборка** | task → **cleaning** | úkol → **úklid** |
| раздел `/problems` | Проблемы → **Задания** | Problems → **Tasks** | Problémy → **Úkoly** |
| одна запись раздела `/problems` | проблема → **задание** | problem → **task** | problém → **úkol** |
| работа техника по заданию (строка `tasks` с `problem_id`) | задача устранения → **работа техника** | fix task → **technician's job** | úkol opravy → **práce technika** |
| задание сделано (было «проблема решена») | решена → **выполнено** | resolved → **done** | vyřešený → **splněný** |

После замены «задание» значит только бывшую «проблему»: ни одна строка не оставляет «задание» или «задачу» в старом смысле. Слово «задача» в новых текстах не встречается совсем.

### Русский: род

- **задание (ср.) → уборка (ж.).** Прилагательные, причастия и местоимения переходят в женский род: «Новое задание» → «Новая уборка», «пришло» → «пришла», «видно» → «видна», «оно» → «она», «каждое» → «каждая», «такое» → «такая», «откройте его» → «откройте её».
- **задача (ж., телефон) → уборка (ж.).** Род тот же, меняется только слово: «Задачу уже взяли, либо её срок истёк» → «Уборку уже взяли, либо её срок истёк». Панель говорила «задание», телефон — «задача»; после замены у обоих одно слово.
- **проблема (ж.) → задание (ср.).** «Новая проблема» → «Новое задание», «не найдена» → «не найдено», «открыта» → «открыто», «её» → «его», «восстановленная» → «восстановленное».
- **Статусы меняются родами.** Статусы уборок (`panel.tasks.statuses.*`, бейдж `panel.tasks.overdue`, фильтры календаря) были в среднем роде — под «задание»; теперь женский: «Назначена», «Принята», «Выполнена», «Отменена», «Просрочена». Статусы заданий (`problems.statuses.*`, они же колонки доски) были в женском — под «проблема»; теперь средний: «Открыто», «Назначено», «Выполнено», «Отменено». Бесродовые («В работе», «Пауза», «Без исполнителя») не меняются.
- **работа (ж.)** — слово для работы техника — совпадает по роду с «уборка», поэтому те же статусы подходят и ей: «Статус работы: Назначена».
- **Множественное «уборка»:** `_one` — 1, 21 уборка; `_few` — 2–4 уборки; `_many` — 5–20 уборок; `_other` — дробные, 1,5 уборки. Все четыре формы есть в ru и cs; в en — `_one` и `_other`, как и было: других форм у английского нет.

### Английский

Рода нет — меняются слово и глагол: task → cleaning, problem → task, resolved → done. Работа техника — **job**: так английский текст её уже называет (`panel.apartments.maintenance.jobs` «Technicians’ jobs», `tasks.work.colleague` «this job»). Строки, где слова task не было (`panel.tasks.form.assigneeRequired`, `panel.team.links.description`, `tasks.emptyMine`, `tasks.claimTaken`), в en остаются.

### Чешский: падежи

úkol, úklid и problém — мужского рода, неодушевлённые, склоняются по образцу *hrad*. Окончания переходят один к одному, а местоимения и согласованные слова (*ho*, *každý*, *takový*, *otevřený*, *nenalezen*, *uzavřen*) не меняются.

| pád | problém → úkol | úkol → úklid |
|---|---|---|
| 1. j. č. | problém → úkol | úkol → úklid |
| 2. j. č. | problému → úkolu | úkolu → úklidu |
| 3. j. č. | problému → úkolu | úkolu → úklidu |
| 4. j. č. | problém → úkol | úkol → úklid |
| 6. j. č. | problému → úkolu | úkolu → úklidu |
| 7. j. č. | problémem → úkolem | úkolem → úklidem |
| 1., 4., 7. mn. č. | problémy → úkoly | úkoly → úklidy |
| 2. mn. č. | problémů → úkolů | úkolů → úklidů |
| 6. mn. č. | problémech → úkolech | úkolech → úklidech |

Множественное у `panel.calendar.moreTasks`: `_one` úklid, `_few` úklidy, `_many` úklidu (десятичные — 2. pád j. č.), `_other` úklidů. Работа техника — **práce** (ženský rod): при ней «zrušen» → «zrušena», «dokončen» → «dokončena».

### Глаголы и слова вместо дословных

- **«решена» → «выполнено».** Решают задачу или проблему, а задание выполняют: «выполнить задание» — устойчивое сочетание, «решённое задание» звучит как школьное упражнение. Тем же словом отмечена сделанная уборка («Выполнена»), так что «сделано» в обоих разделах читается одинаково и различается только родом. В en — «Done»: resolved — слово для problem и issue, Done — уже статус уборок. В cs — «Splněný»: *splnit úkol* — такое же устойчивое сочетание, как «выполнить задание», а *vyřešit* идёт к *problém*. Вопрос 2.
- **Работа техника — «работа», не «уборка».** Бывшая «задача устранения» — строка `tasks`, которую техник выполняет по заданию. Дословно вышло бы «Уборка устранения» и «Уборка техника отменена». Код телефона этот выбор уже сделал: «An inspection and a repair are work: a technician is not cleaning a boiler» (`apps/mobile/src/features/tasks/format.ts:123`) — для осмотра и обслуживания телефон пишет «Начать работу», «Шаги работы», а карточка объекта в панели — «Работы техников». Эти строки говорят так же: «Работа техника», «Шаги работы», «Статус работы», процесс «Работы по заданиям». Вопрос 4.
- **«Сообщить о проблеме» → «Создать задание».** «Сообщить о задании» по-русски значит другое. Кнопка создаёт задание — так и названа; форма за ней уже «Новое задание». Вопрос 5.
- **Существительное убрано** там, где любое из двух слов было бы неверным: `panel.tasks.form.description` (дословно «без названия уборка называется „Осмотр“»), `panel.tasks.form.type` («Тип», как у фильтра рядом), `panel.settings.workflow.none` (над текстом уже выбрано «Процесс для: …»), `serverErrors.taskChangedMeanwhile` (одна фраза и для отмены уборки, и для снятия техника с задания — обе идут через `cancelLiveTask`).
- **`panel.problems.board.startOnPhone`** называет кнопку телефона («Начать работу» / “Start work” / „Začít práci“): дословное «В работу задание переводит техник, начав работу» повторяет «работу» дважды.
- **`panel.settings.galleryHint`:** «и на устранение проблем» → «и на задания». Переключатель проверяют две функции — `add_task_media` (шаги уборок всех видов, в том числе ремонта) и `add_problem_media` (фото, приложенные к заданию); новая фраза называет ровно их.

### Что остаётся

- «Уборка» в прямом смысле — вид `cleaning` и `midstay` и сама уборка квартиры. Раздел «Уборки» теперь содержит вид «Уборка» рядом с «Осмотр» и «Обслуживание»; ключи, где это слово уже стояло, не меняются и в таблицу не входят — их 35: `auth.heading`, `panel.settings.parallelStartHint`, `panel.settings.workflow.scopes.cleaning`, `panel.settings.workflow.scopes.midstay`, `panel.tasks.types.cleaning`, `panel.tasks.types.midstay`, `panel.tasks.actions.openWork`, `panel.tasks.form.windowFromBooking`, `panel.tasks.work.title`, `panel.tasks.work.short`, `panel.tasks.work.parallel`, `panel.apartments.columns.cleanings`, `panel.apartments.confirm.cancels`, `panel.apartments.confirm.keeps`, `panel.apartments.confirm.restores`, `panel.apartments.cleaners.empty`, `panel.apartments.info.window`, `panel.apartments.info.parentHint`, `panel.apartments.maintenance.stateHint`, `panel.apartments.room.cleaners`, `tasks.emptyQueue`, `tasks.start`, `tasks.finish`, `tasks.claimAccessibility`, `tasks.kinds.cleaning`, `tasks.kinds.midstay`, `tasks.detail.window`, `tasks.detail.finished`, `tasks.detail.colleague`, `steps.heading`, `supplies.priorityHint`, `serverErrors.propertyHasOpenTasks_one`, `serverErrors.propertyHasOpenTasks_few`, `serverErrors.propertyHasOpenTasks_many`, `serverErrors.propertyHasOpenTasks_other`.
- Проверены и остаются (в таблице с пометкой «без изменений»): «Просрочен» у бейджа ремонта в календаре (согласован с «ремонт»), «Не состоялась» у несостоявшейся уборки (уже ж. р.), «Начата» и «Завершена» на телефоне (ж. р. и при «задача», и при «уборка»).
- Синонимы — раздел 4.

## 2. Таблица

«без изменений» — текст на этом языке остаётся; «—» — такой формы в языке нет (английский знает только `_one` и `_other`). «добавлен» в заметке — ключа не было во входе, «проверен» — ключ прочитан и остаётся.

| область | строк | меняются | остаются |
|---|---|---|---|
| Панель: меню | 2 | 2 | 0 |
| Панель: задания → уборки | 25 | 25 | 0 |
| Панель: проблемы → задания | 28 | 28 | 0 |
| Панель: календарь | 16 | 13 | 3 |
| Панель: настройки | 5 | 5 | 0 |
| Панель: команда | 2 | 2 | 0 |
| Панель: чат | 2 | 2 | 0 |
| Панель: дашборд | 1 | 1 | 0 |
| Панель: квартиры | 1 | 1 | 0 |
| Телефон | 32 | 30 | 2 |
| Ошибки сервера | 13 | 13 | 0 |
| **всего** | **127** | **122** | **5** |

### Панель: меню

| ключ | ru было | ru стало | en было | en стало | cs было | cs стало | заметка |
|---|---|---|---|---|---|---|---|
| `panel.nav.problems` | Проблемы | Задания | Problems | Tasks | Problémy | Úkoly | раздел `/problems` |
| `panel.nav.tasks` | Задания | Уборки | Tasks | Cleanings | Úkoly | Úklidy | раздел `/tasks` |

### Панель: задания → уборки

| ключ | ru было | ru стало | en было | en стало | cs было | cs стало | заметка |
|---|---|---|---|---|---|---|---|
| `panel.tasks.title` | Задания | Уборки | Tasks | Cleanings | Úkoly | Úklidy | заголовок раздела |
| `panel.tasks.loading` | Загружаем задания… | Загружаем уборки… | Loading tasks… | Loading cleanings… | Načítáme úkoly… | Načítáme úklidy… |  |
| `panel.tasks.loadError` | Не удалось загрузить задания | Не удалось загрузить уборки | Could not load the tasks | Could not load the cleanings | Úkoly se nepodařilo načíst | Úklidy se nepodařilo načíst |  |
| `panel.tasks.empty` | Заданий пока нет | Уборок пока нет | No tasks yet | No cleanings yet | Zatím žádné úkoly | Zatím žádné úklidy |  |
| `panel.tasks.statuses.assigned` | Назначено | Назначена | Assigned | без изменений | Přiděleno | без изменений | добавлен: статус согласован с «задание» (ср.), теперь с «уборка» (ж.) |
| `panel.tasks.statuses.accepted` | Принято | Принята | Accepted | без изменений | Přijato | без изменений | добавлен: род, как выше |
| `panel.tasks.statuses.blocked` | Заблокировано | Заблокирована | Blocked | без изменений | Blokováno | без изменений | добавлен: род, как выше |
| `panel.tasks.statuses.done` | Выполнено | Выполнена | Done | без изменений | Hotovo | без изменений | добавлен: род, как выше |
| `panel.tasks.statuses.cancelled` | Отменено | Отменена | Cancelled | без изменений | Zrušeno | без изменений | добавлен: род, как выше |
| `panel.tasks.statuses.expired` | Просрочено | Просрочена | Expired | без изменений | Propadlo | без изменений | добавлен: род, как выше; тот же статус показывают фишки календаря и «Работы техников» на карточке объекта — «работа» тоже ж. р. |
| `panel.tasks.overdue` | Просрочено | Просрочена | Overdue | без изменений | Propadlo | без изменений | добавлен: бейдж просрочки на экране «Уборки», в пару к статусу |
| `panel.tasks.origin.problem` | Из проблемы | Из задания | From a problem | From a task | Z problému | Z úkolu | метка происхождения: уборка (ремонт) пришла из задания |
| `panel.tasks.actions.new` | Новое задание | Новая уборка | New task | New cleaning | Nový úkol | Nový úklid | ср. → ж.; кнопка создаёт и осмотр, и обслуживание — вопрос 1 |
| `panel.tasks.actions.cancel` | Отменить задание | Отменить уборку | Cancel the task | Cancel the cleaning | Zrušit úkol | Zrušit úklid |  |
| `panel.tasks.actions.cancelConfirm` | Отменить задание? Оно останется в истории. | Отменить уборку? Она останется в истории. | Cancel this task? It stays as history. | Cancel this cleaning? It stays as history. | Zrušit tento úkol? Zůstane v historii. | Zrušit tento úklid? Zůstane v historii. | «оно» → «она» |
| `panel.tasks.form.titleNew` | Новое задание | Новая уборка | New task | New cleaning | Nový úkol | Nový úklid | ср. → ж.; вопрос 1 |
| `panel.tasks.form.titleEdit` | Изменить задание | Изменить уборку | Edit the task | Edit the cleaning | Upravit úkol | Upravit úklid |  |
| `panel.tasks.form.description` | Необязательно: без названия задание называется по типу — «Уборка», «Осмотр». | Необязательно: без названия показывается тип — «Уборка», «Осмотр». | Optional: without a title the task is called by its kind — "Cleaning", "Inspection". | Optional: without a title, the kind is shown — "Cleaning", "Inspection". | Volitelné: bez názvu se úkol jmenuje podle svého druhu — „Úklid“, „Kontrola“. | Volitelné: bez názvu se ukáže druh — „Úklid“, „Kontrola“. | дословно вышло бы «уборка называется „Осмотр“» — существительное убрано, смысл тот же |
| `panel.tasks.form.type` | Тип задания | Тип | Kind of task | Kind | Druh úkolu | Druh | как у фильтра рядом (`panel.tasks.filters.type`); дословно — «Тип уборки: Осмотр». Если владелец за дословное: «Тип уборки» / «Kind of cleaning» / «Druh úklidu» |
| `panel.tasks.form.assigneeRequired` | Осмотру и обслуживанию нужен исполнитель: выберите, кто сделает задание. | Осмотру и обслуживанию нужен исполнитель: выберите, кто сделает работу. | An inspection or a maintenance job needs an executor: pick who will do it. | без изменений | Kontrola a údržba musí mít přiřazeného pracovníka: vyberte, kdo úkol udělá. | Kontrola a údržba musí mít přiřazeného pracovníka: vyberte, kdo práci udělá. | осмотр и обслуживание — «работа», как на телефоне (`tasks.work.*`); en слова task не содержит |
| `panel.tasks.form.generatedHint` | Задание пришло из брони или из проблемы: объект и тип менять нельзя. | Уборка пришла из брони или из задания: объект и тип менять нельзя. | This task came from a booking or a problem: its listing and kind cannot be changed. | This cleaning came from a booking or a task: its listing and kind cannot be changed. | Úkol vznikl z rezervace nebo z problému: byt ani druh nelze změnit. | Úklid vznikl z rezervace nebo z úkolu: byt ani druh nelze změnit. | «пришло» → «пришла»; «из проблемы» → «из задания» |
| `panel.tasks.work.titleOpen` | Задание | Уборка | Task | Cleaning | Úkol | Úklid | заголовок окна незавершённой уборки любого вида, в том числе ремонта — вопрос 1 |
| `panel.tasks.work.noSteps` | У задания не было шагов | У уборки не было шагов | This task had no steps | This cleaning had no steps | Úkol neměl žádné kroky | Úklid neměl žádné kroky |  |
| `panel.tasks.work.problems` | Проблемы с этой уборки | Задания с этой уборки | Problems from this cleaning | Tasks from this cleaning | Problémy z tohoto úklidu | Úkoly z tohoto úklidu | «уборка» здесь уже была и остаётся |
| `panel.tasks.work.noProblems` | Проблем не было | Заданий не было | No problems were reported | No tasks were reported | Žádné problémy nebyly nahlášeny | Žádné úkoly nebyly nahlášeny |  |

### Панель: проблемы → задания

| ключ | ru было | ru стало | en было | en стало | cs было | cs стало | заметка |
|---|---|---|---|---|---|---|---|
| `panel.problems.title` | Проблемы | Задания | Problems | Tasks | Problémy | Úkoly | заголовок раздела |
| `panel.problems.empty` | Проблем нет | Заданий нет | No problems | No tasks | Žádné problémy | Žádné úkoly |  |
| `panel.problems.loading` | Загружаем проблемы… | Загружаем задания… | Loading problems… | Loading tasks… | Načítáme problémy… | Načítáme úkoly… |  |
| `panel.problems.loadError` | Не удалось загрузить проблемы | Не удалось загрузить задания | Could not load the problems | Could not load the tasks | Problémy se nepodařilo načíst | Úkoly se nepodařilo načíst |  |
| `panel.problems.notFound` | Проблема не найдена | Задание не найдено | Problem not found | Task not found | Problém nenalezen | Úkol nenalezen | «найдена» → «найдено» |
| `panel.problems.columns.title` | Проблема | Задание | Problem | Task | Problém | Úkol | заголовок колонки |
| `panel.problems.columns.reported` | Заявлена | Заявлено | Reported | без изменений | Nahlášeno | без изменений | добавлен: заголовок колонки согласован с «проблема» |
| `panel.problems.detail.back` | К списку проблем | К списку заданий | Back to problems | Back to tasks | Zpět na problémy | Zpět na úkoly |  |
| `panel.problems.detail.reportedAt` | Заявлена {{date}} | Заявлено {{date}} | Reported {{date}} | без изменений | Nahlášeno {{date}} | без изменений | добавлен: род, как у колонки |
| `panel.problems.detail.fromTask` | Найдена во время уборки | Найдено во время уборки | Found during a cleaning | без изменений | Nalezeno během úklidu | без изменений | добавлен (регэксп видел только «уборки»): «найдена» → «найдено»; «уборка» здесь — сама уборка |
| `panel.problems.detail.fixTask` | Задача устранения | Работа техника | Fix task | Technician's job | Úkol opravy | Práce technika | бывшая «задача устранения»; «работа» — как «Работы техников» на карточке объекта и `tasks.work.*` на телефоне; вопрос 4 |
| `panel.problems.detail.steps` | Шаги задачи | Шаги работы | Task steps | Work steps | Kroky úkolu | Kroky práce | дословно как `tasks.work.steps` на телефоне |
| `panel.problems.detail.noSteps` | Шаги появятся, когда техник начнёт задачу | Шаги появятся, когда техник начнёт работу | Steps appear once the technician starts the task | Steps appear once the technician starts the job | Kroky se objeví, až technik úkol zahájí | Kroky se objeví, až technik zahájí práci |  |
| `panel.problems.detail.resolvedAt` | Решена {{date}} | Выполнено {{date}} | Resolved {{date}} | Done {{date}} | Vyřešeno {{date}} | Splněno {{date}} | добавлен: «решена» → «выполнено» — глагол для задания, вопрос 2 |
| `panel.problems.detail.cancelledAt` | Отменена {{date}} | Отменено {{date}} | Cancelled {{date}} | без изменений | Zrušeno {{date}} | без изменений | добавлен: род |
| `panel.problems.detail.taskStatus` | Статус задачи: {{status}} | Статус работы: {{status}} | Task status: {{status}} | Job status: {{status}} | Stav úkolu: {{status}} | Stav práce: {{status}} | вместо `{{status}}` сейчас приходит сырой код — раздел 4 |
| `panel.problems.assign.noProperty` | У проблемы нет объекта, поэтому задачу назначить нельзя | У задания нет объекта, поэтому работу назначить нельзя | The problem has no listing, so a task cannot be scheduled | The task has no listing, so a job cannot be scheduled | Problém nemá objekt, úkol proto nelze naplánovat | Úkol nemá objekt, práci proto nelze naplánovat | назначается работа техника, не задание |
| `panel.problems.actions.resolve` | Отметить решённой | Отметить выполненным | Mark as resolved | Mark as done | Označit jako vyřešený | Označit jako splněný | добавлен: глагол, вопрос 2 |
| `panel.problems.actions.cancel` | Отменить проблему | Отменить задание | Cancel the problem | Cancel the task | Zrušit problém | Zrušit úkol |  |
| `panel.problems.actions.archiveText` | Проблема исчезнет с доски, из списка и из приложений сотрудников. Ничего не удаляется: вернуть её можно из вкладки «Архив». | Задание исчезнет с доски, из списка и из приложений сотрудников. Ничего не удаляется: вернуть его можно из вкладки «Архив». | The problem disappears from the board, the list and the staff apps. Nothing is deleted: it can be brought back from the Archive tab. | The task disappears from the board, the list and the staff apps. Nothing is deleted: it can be brought back from the Archive tab. | Problém zmizí z nástěnky, ze seznamu i z aplikací zaměstnanců. Nic se nemaže: lze ho vrátit ze záložky Archiv. | Úkol zmizí z nástěnky, ze seznamu i z aplikací zaměstnanců. Nic se nemaže: lze ho vrátit ze záložky Archiv. | «её» → «его» |
| `panel.problems.board.startOnPhone` | В работу проблему переводит техник, начав задачу в приложении | В работу задание переводит техник кнопкой «Начать работу» в приложении | Only the technician moves a problem into work, by starting the task in the app | Only the technician moves a task into work, with the “Start work” button in the app | Do práce problém převádí technik, když úkol zahájí v aplikaci | Do práce úkol převádí technik tlačítkem „Začít práci“ v aplikaci | дословное «…начав работу» дало бы «в работу … работу»; кнопка на телефоне так и называется (`tasks.work.start`) |
| `panel.problems.board.unassigned` | Задача техника отменена, проблема снова открыта | Работа техника отменена, задание снова открыто | The technician's task is cancelled, the problem is open again | The technician's job is cancelled, the task is open again | Úkol technika je zrušen, problém je znovu otevřený | Práce technika je zrušena, úkol je znovu otevřený | «отменена» остаётся (работа — ж. р.), «открыта» → «открыто» |
| `panel.problems.board.resolveTitle` | Отметить решённой? | Отметить выполненным? | Mark as resolved? | Mark as done? | Označit jako vyřešený? | Označit jako splněný? | добавлен: глагол, вопрос 2 |
| `panel.problems.board.resolveText` | «{{title}}» закроется как решённая. Задача техника, если она есть, будет завершена. | «{{title}}» закроется как выполненное. Работа техника, если она есть, будет завершена. | “{{title}}” will close as resolved. The technician's task, if any, will be finished. | “{{title}}” will close as done. The technician's job, if any, will be finished. | „{{title}}“ se uzavře jako vyřešený. Úkol technika, pokud existuje, bude dokončen. | „{{title}}“ se uzavře jako splněný. Práce technika, pokud existuje, bude dokončena. | «решённая» → «выполненное» (задание, ср.); «задача техника» → «работа техника», «она» остаётся |
| `panel.problems.board.resolveConfirm` | Да, решена | Да, выполнено | Yes, resolved | Yes, done | Ano, vyřešeno | Ano, splněno | добавлен: глагол, вопрос 2 |
| `panel.problems.board.reopened` | Проблема снова открыта | Задание снова открыто | The problem is open again | The task is open again | Problém je znovu otevřený | Úkol je znovu otevřený | «открыта» → «открыто» |
| `panel.problems.board.columnEmpty` | ✨ Проблем пока нет | ✨ Заданий пока нет | ✨ No problems yet | ✨ No tasks yet | ✨ Zatím žádné problémy | ✨ Zatím žádné úkoly |  |
| `panel.problems.archive.hint` | Проблемы из архива не видны сотрудникам и не попадают на доску. Восстановленная проблема возвращается в том же статусе. | Задания из архива не видны сотрудникам и не попадают на доску. Восстановленное задание возвращается в том же статусе. | Archived problems are hidden from the staff and stay off the board. A restored problem comes back in the status it had. | Archived tasks are hidden from the staff and stay off the board. A restored task comes back in the status it had. | Archivované problémy zaměstnanci nevidí a na nástěnce nejsou. Obnovený problém se vrátí ve stejném stavu. | Archivované úkoly zaměstnanci nevidí a na nástěnce nejsou. Obnovený úkol se vrátí ve stejném stavu. | «восстановленная» → «восстановленное» |

### Панель: календарь

| ключ | ru было | ru стало | en было | en стало | cs было | cs стало | заметка |
|---|---|---|---|---|---|---|---|
| `panel.calendar.moreTasks_one` | Ещё {{count}} задание | Ещё {{count}} уборка | {{count}} more task | {{count}} more cleaning | Ještě {{count}} úkol | Ještě {{count}} úklid | ru: 1, 21, 31… |
| `panel.calendar.moreTasks_few` | Ещё {{count}} задания | Ещё {{count}} уборки | — | — | Ještě {{count}} úkoly | Ještě {{count}} úklidy | ru: 2–4, 22–24…; в en формы нет |
| `panel.calendar.moreTasks_many` | Ещё {{count}} заданий | Ещё {{count}} уборок | — | — | Ještě {{count}} úkolu | Ještě {{count}} úklidu | ru: 5–20, 25…; в en формы нет |
| `panel.calendar.moreTasks_other` | Ещё {{count}} задания | Ещё {{count}} уборки | {{count}} more tasks | {{count}} more cleanings | Ještě {{count}} úkolů | Ještě {{count}} úklidů | ru: дробные (1,5 уборки) |
| `panel.calendar.loadingTasks` | Загружаем задания… | Загружаем уборки… | Loading tasks… | Loading cleanings… | Načítáme úkoly… | Načítáme úklidy… |  |
| `panel.calendar.tasksError` | Не удалось загрузить задания. | Не удалось загрузить уборки. | Could not load the tasks. | Could not load the cleanings. | Úkoly se nepodařilo načíst. | Úklidy se nepodařilo načíst. |  |
| `panel.calendar.filters.open` | Открыто | Открыта | Open | без изменений | Otevřené | без изменений | добавлен: фильтр статуса над фишками уборок, в пару к статусам (`panel.tasks.statuses`) |
| `panel.calendar.filters.done` | Выполнено | Выполнена | Done | без изменений | Hotovo | без изменений | добавлен: как выше |
| `panel.calendar.filters.nobody` | Не назначено | без изменений | Unassigned | без изменений | Nepřiřazeno | без изменений | проверен: стоит под «Исполнитель», рядом с «Все» и именами — «Не назначена» читалось бы как «Исполнитель: Не назначена»; безличное «Не назначено» подходит и после замены (ревью) |
| `panel.calendar.stand.newTask` | Новое задание: {{place}}, {{day}} | Новая уборка: {{place}}, {{day}} | New task: {{place}}, {{day}} | New cleaning: {{place}}, {{day}} | Nový úkol: {{place}}, {{day}} | Nový úklid: {{place}}, {{day}} | ср. → ж.; вопрос 1 |
| `panel.calendar.expiredMark` | Не состоялась | без изменений | Did not happen | без изменений | Neproběhlo | без изменений | без изменений (проверен): «Не состоялась» уже в ж. р. — совпадает с «уборка» |
| `panel.calendar.overdue` | Просрочен | без изменений | Overdue | без изменений | Po termínu | без изменений | без изменений (проверен): «Просрочен» согласован с «ремонт» (бейдж ремонта у объекта), не с разделом |
| `panel.calendar.chipView` | Вид заданий | Вид уборок | Task view | Cleaning view | Zobrazení úkolů | Zobrazení úklidů |  |
| `panel.calendar.expiredError` | Не удалось загрузить несостоявшиеся задания. | Не удалось загрузить несостоявшиеся уборки. | Could not load the tasks that did not happen. | Could not load the cleanings that did not happen. | Neproběhlé úkoly se nepodařilo načíst. | Neproběhlé úklidy se nepodařilo načíst. |  |
| `panel.calendar.cancelledError` | Не удалось загрузить отменённые задания. | Не удалось загрузить отменённые уборки. | Could not load the cancelled tasks. | Could not load the cancelled cleanings. | Zrušené úkoly se nepodařilo načíst. | Zrušené úklidy se nepodařilo načíst. |  |
| `panel.calendar.taskMissing` | Задание не удалось открыть. | Уборку не удалось открыть. | The task could not be opened. | The cleaning could not be opened. | Úkol se nepodařilo otevřít. | Úklid se nepodařilo otevřít. |  |

### Панель: настройки

| ключ | ru было | ru стало | en было | en стало | cs было | cs стало | заметка |
|---|---|---|---|---|---|---|---|
| `panel.settings.galleryHint` | Выкл.: фото и видео снимаются только камерой и только на месте. Вкл.: горничная может приложить готовый файл из галереи — в том числе снятый в другой квартире или неделю назад, и тогда медиа перестаёт быть свидетельством состояния квартиры на момент уборки. Действует и на уборки, и на устранение проблем. | Выкл.: фото и видео снимаются только камерой и только на месте. Вкл.: горничная может приложить готовый файл из галереи — в том числе снятый в другой квартире или неделю назад, и тогда медиа перестаёт быть свидетельством состояния квартиры на момент уборки. Действует и на уборки, и на задания. | Off: photos and video are taken with the camera, on the spot. On: a cleaner may attach a file from the gallery — including one taken in another flat or a week ago, and then the media is no longer evidence of the state of the flat at the time of the cleaning. Applies to cleanings and to fixing problems alike. | Off: photos and video are taken with the camera, on the spot. On: a cleaner may attach a file from the gallery — including one taken in another flat or a week ago, and then the media is no longer evidence of the state of the flat at the time of the cleaning. Applies to cleanings and to tasks alike. | Vypnuto: fotky a video se pořizují jen fotoaparátem a přímo na místě. Zapnuto: uklízečka může přiložit hotový soubor z galerie — i pořízený v jiném bytě nebo před týdnem, a pak médium přestává být důkazem o stavu bytu v době úklidu. Platí pro úklidy i pro řešení problémů. | Vypnuto: fotky a video se pořizují jen fotoaparátem a přímo na místě. Zapnuto: uklízečka může přiložit hotový soubor z galerie — i pořízený v jiném bytě nebo před týdnem, a pak médium přestává být důkazem o stavu bytu v době úklidu. Platí pro úklidy i pro úkoly. | меняется только последняя фраза. Переключатель проверяют `add_task_media` (шаги уборок всех видов, в том числе ремонта) и `add_problem_media` (фото задания) — новая фраза называет ровно эти два места |
| `panel.settings.workflow.runningNote` | Правка не трогает задания, которые уже идут: каждое работает по снимку, снятому на старте. | Правка не трогает уборки, которые уже идут: каждая работает по снимку, снятому на старте. | An edit leaves tasks already under way alone: each follows the snapshot taken when it started. | An edit leaves cleanings already under way alone: each follows the snapshot taken when it started. | Úprava se nedotkne úkolů, které už běží: každý jde podle snímku pořízeného při startu. | Úprava se nedotkne úklidů, které už běží: každý jde podle snímku pořízeného při startu. | «каждое» → «каждая» |
| `panel.settings.workflow.scopes.problem` | Устранения проблем | Работы по заданиям | Fixing problems | Work on tasks | Řešení problémů | Práce na úkolech | процесс для работы техника по заданию; соседи в списке: «Уборки», «Уборки в проживание», «Осмотры» |
| `panel.settings.workflow.none` | Процесса для этого вида задач ещё нет. Добавьте шаги и сохраните. | Процесса для этого вида ещё нет. Добавьте шаги и сохраните. | There is no process for this kind of task yet. Add steps and save. | There is no process for this kind yet. Add steps and save. | Pro tento druh úkolu zatím proces není. Přidejte kroky a uložte. | Pro tento druh zatím proces není. Přidejte kroky a uložte. | существительное убрано: над текстом стоит выбор «Процесс для: …»; дословное «вида уборок» при выбранных «Осмотрах» было бы неверно |
| `panel.settings.workflow.stepTypes.task_note` | Заметка к заданию | Заметка к уборке | Task note | Cleaning note | Poznámka k úkolu | Poznámka k úklidu | шаг есть и в процессе «Работы по заданиям» — вопрос 1 |

### Панель: команда

| ключ | ru было | ru стало | en было | en стало | cs было | cs стало | заметка |
|---|---|---|---|---|---|---|---|
| `panel.team.form.propertiesHint` | Сотрудник видит задания только по тем объектам, которые отмечены здесь. | Сотрудник видит уборки только по тем объектам, которые отмечены здесь. | The person sees tasks only for the listings ticked here. | The person sees cleanings only for the listings ticked here. | Zaměstnanec vidí úkoly jen u objektů, které jsou tu zaškrtnuté. | Zaměstnanec vidí úklidy jen u objektů, které jsou tu zaškrtnuté. |  |
| `panel.team.links.description` | «Закреплён» — задание становится его сразу, как появится. «Из очереди» — задание ждёт, кто возьмёт первым. | «Закреплён» — уборка становится его сразу, как появится. «Из очереди» — уборка ждёт, кто возьмёт первым. | "Assigned" hands the job over the moment it appears. "From the queue" leaves it for whoever takes it first. | без изменений | „Napevno“ přiřadí úkol hned, jak vznikne. „Z fronty“ ho nechá tomu, kdo si ho vezme první. | „Napevno“ přiřadí úklid hned, jak vznikne. „Z fronty“ ho nechá tomu, kdo si ho vezme první. | «его» здесь — сотрудника, не задания, остаётся; en «job» — синоним, остаётся |

### Панель: чат

| ключ | ru было | ru стало | en было | en стало | cs было | cs стало | заметка |
|---|---|---|---|---|---|---|---|
| `panel.chat.audienceTask` | Видят те, кому видно задание: исполнитель, горничные объекта и менеджеры | Видят те, кому видна уборка: исполнитель, горничные объекта и менеджеры | Seen by whoever sees the task: the assignee, the cleaners of the listing and the managers | Seen by whoever sees the cleaning: the assignee, the cleaners of the listing and the managers | Vidí ti, kdo vidí úkol: přidělený pracovník, uklízečky objektu a manažeři | Vidí ti, kdo vidí úklid: přidělený pracovník, uklízečky objektu a manažeři | «видно» → «видна» |
| `panel.chat.audienceProblem` | Видят те, кому видна поломка: кто сообщил, техник и менеджеры | без изменений | Seen by whoever sees the problem: the reporter, the technician and the managers | Seen by whoever sees the task: the reporter, the technician and the managers | Vidí ti, kdo vidí závadu: kdo ji nahlásil, technik a manažeři | без изменений | ru «поломка» и cs «závada» — синонимы, по правилу остаются; en называл сущность словом problem — меняется. Вопрос 6 |

### Панель: дашборд

| ключ | ru было | ru стало | en было | en стало | cs было | cs стало | заметка |
|---|---|---|---|---|---|---|---|
| `panel.dashboard.emptyHint` | Показатели появятся вместе с разделами. Начните с проблем и заявок. | Показатели появятся вместе с разделами. Начните с заданий и заявок. | Figures arrive with the sections. Start with problems and supply requests. | Figures arrive with the sections. Start with tasks and supply requests. | Čísla přijdou spolu se sekcemi. Začněte problémy a žádostmi o materiál. | Čísla přijdou spolu se sekcemi. Začněte úkoly a žádostmi o materiál. |  |

### Панель: квартиры

| ключ | ru было | ru стало | en было | en стало | cs было | cs стало | заметка |
|---|---|---|---|---|---|---|---|
| `panel.apartments.info.cleanerNotesHint` | Видна в приложении на экране задания. | Видна в приложении на экране уборки. | Shown in the app on the task screen. | Shown in the app on the cleaning screen. | Zobrazí se v aplikaci u úkolu. | Zobrazí se v aplikaci u úklidu. |  |

### Телефон

| ключ | ru было | ru стало | en было | en стало | cs было | cs стало | заметка |
|---|---|---|---|---|---|---|---|
| `tabs.myTasks` | Мои задачи | Мои уборки | My tasks | My cleanings | Moje úkoly | Moje úklidy | вкладка телефона; у техника в ней ремонты — вопрос 3 |
| `tabs.problems` | Проблемы | Задания | Problems | Tasks | Problémy | Úkoly | вкладка телефона |
| `tasks.loading` | Загружаем задачи… | Загружаем уборки… | Loading tasks… | Loading cleanings… | Načítáme úkoly… | Načítáme úklidy… | на телефоне было «задача» (ж.) — род не меняется |
| `tasks.loadFailed` | Не удалось загрузить задачи | Не удалось загрузить уборки | Could not load tasks | Could not load cleanings | Úkoly se nepodařilo načíst | Úklidy se nepodařilo načíst |  |
| `tasks.emptyMine` | Пока нет назначенных задач. Загляните во «Свободные» — там может быть работа на ваших объектах. | Пока нет назначенных уборок. Загляните во «Свободные» — там может быть работа на ваших объектах. | Nothing assigned to you yet. Look in “Available” — there may be work on your listings. | без изменений | Zatím vám nebyl přidělen žádný úkol. Podívejte se do „Volné“ — na vašich objektech může být práce. | Zatím vám nebyl přidělen žádný úklid. Podívejte se do „Volné“ — na vašich objektech může být práce. | «работа» — не название раздела, остаётся; en слова task не содержит |
| `tasks.claimFailedTitle` | Не получилось взять задачу | Не получилось взять уборку | Could not take the task | Could not take the cleaning | Úkol se nepodařilo vzít | Úklid se nepodařilo vzít |  |
| `tasks.claimTaken` | Задачу уже взяли, либо её срок истёк. | Уборку уже взяли, либо её срок истёк. | Someone already took it, or its day has passed. | без изменений | Úkol si už někdo vzal, nebo už vypršel. | Úklid si už někdo vzal, nebo už vypršel. | «её» остаётся (ж. → ж.); en слова task не содержит |
| `tasks.startFailed` | Не удалось начать задачу — обновите список. | Не удалось начать уборку — обновите список. | Could not start the task — refresh the list. | Could not start the cleaning — refresh the list. | Úkol se nepodařilo začít — obnovte seznam. | Úklid se nepodařilo začít — obnovte seznam. | у техника кнопка «Начать работу» — вопрос 1 |
| `tasks.finishFailed` | Не удалось завершить задачу — обновите список. | Не удалось завершить уборку — обновите список. | Could not finish the task — refresh the list. | Could not finish the cleaning — refresh the list. | Úkol se nepodařilo dokončit — obnovte seznam. | Úklid se nepodařilo dokončit — obnovte seznam. | как выше — вопрос 1 |
| `tasks.detail.startedAt` | Начата | без изменений | Started | без изменений | Začátek | без изменений | без изменений (проверен): «Начата» — ж. р., совпадает и с «задача», и с «уборка» |
| `tasks.detail.completedAt` | Завершена | без изменений | Finished | без изменений | Konec | без изменений | без изменений (проверен): «Завершена», как выше |
| `tasks.detail.parallel` | Шла параллельно с другой задачей | Шла параллельно с другой уборкой | Ran alongside another task | Ran alongside another cleaning | Probíhal souběžně s jiným úkolem | Probíhal souběžně s jiným úklidem | «шла» остаётся (ж.) |
| `tasks.detail.closed` | Задача закрыта | Уборка закрыта | Task closed | Cleaning closed | Úkol je uzavřen | Úklid je uzavřen |  |
| `tasks.detail.reportProblem` | Сообщить о проблеме | Создать задание | Report a problem | Create a task | Nahlásit problém | Vytvořit úkol | кнопка на экране уборки; «Сообщить о задании» не по-русски — вопрос 5 |
| `tasks.detail.problem` | Проблема | Задание | Problem | Task | Problém | Úkol | подпись блока на работе техника: из какого задания она |
| `tasks.detail.openProblem` | Открыть проблему | Открыть задание | Open the problem | Open the task | Otevřít problém | Otevřít úkol |  |
| `tasks.detail.notFound` | Задача не найдена или больше не ваша | Уборка не найдена или больше не ваша | Task not found, or no longer yours | Cleaning not found, or no longer yours | Úkol nenalezen, nebo už není váš | Úklid nenalezen, nebo už není váš |  |
| `steps.types.task_note` | Указания к заданию | Указания к уборке | Task instructions | Cleaning instructions | Pokyny k úkolu | Pokyny k úklidu | шаг видит и техник на ремонте — вопрос 1 |
| `steps.commentPlaceholder` | Что стоит знать менеджеру об этой задаче… | Что стоит знать менеджеру об этой уборке… | Anything the office should know about this task… | Anything the office should know about this cleaning… | Co by měla kancelář vědět o tomto úkolu… | Co by měla kancelář vědět o tomto úklidu… |  |
| `steps.readOnly` | Шаги можно менять, только пока задача в работе | Шаги можно менять, только пока уборка в работе | Steps can be changed only while the task is in progress | Steps can be changed only while the cleaning is in progress | Kroky lze měnit, jen dokud úkol probíhá | Kroky lze měnit, jen dokud úklid probíhá |  |
| `problems.report` | Сообщить о проблеме | Создать задание | Report a problem | Create a task | Nahlásit problém | Vytvořit úkol | кнопка над списком заданий — вопрос 5 |
| `problems.new` | Новая проблема | Новое задание | New problem | New task | Nový problém | Nový úkol | «новая» → «новое» |
| `problems.one` | Проблема | Задание | Problem | Task | Problém | Úkol | заголовок экрана |
| `problems.loading` | Загружаем проблемы… | Загружаем задания… | Loading problems… | Loading tasks… | Načítáme problémy… | Načítáme úkoly… |  |
| `problems.emptyMine` | Проблем не заявлено | Заданий не заявлено | No problems reported | No tasks reported | Žádné nahlášené problémy | Žádné nahlášené úkoly | по-прежнему «заявлено» — горничная задание заявляет |
| `problems.notFound` | Проблема не найдена | Задание не найдено | Problem not found | Task not found | Problém nenalezen | Úkol nenalezen | «найдена» → «найдено» |
| `problems.notEditable` | Проблему уже взяли в работу — изменить её нельзя | Задание уже взяли в работу — изменить его нельзя | The problem has been picked up — it can no longer be changed | The task has been picked up — it can no longer be changed | Problém už někdo převzal — nelze ho změnit | Úkol už někdo převzal — nelze ho změnit | «её» → «его» |
| `problems.statuses.open` | Открыта | Открыто | Open | без изменений | Otevřený | без изменений | добавлен: статусы заданий согласованы с «проблема» (ж.) → «задание» (ср.); те же ключи — колонки доски и бейджи панели |
| `problems.statuses.assigned` | Назначена | Назначено | Assigned | без изменений | Přidělený | без изменений | добавлен: род, как выше |
| `problems.statuses.resolved` | Решена | Выполнено | Resolved | Done | Vyřešený | Splněný | добавлен: «решена» → «выполнено», вопрос 2 |
| `problems.statuses.cancelled` | Отменена | Отменено | Cancelled | без изменений | Zrušený | без изменений | добавлен: род |
| `problems.openFixTask` | Открыть задачу по устранению | Открыть работу техника | Open the fix task | Open the technician's job | Otevřít úkol opravy | Otevřít práci technika | бывшая «задача по устранению»; вопрос 4 |

### Ошибки сервера

| ключ | ru было | ru стало | en было | en стало | cs было | cs стало | заметка |
|---|---|---|---|---|---|---|---|
| `serverErrors.parallelStartOff` | Сначала завершите текущую задачу — параллельный старт выключен | Сначала завершите текущую уборку — параллельный старт выключен | Finish the task in progress first — parallel start is off | Finish the cleaning in progress first — parallel start is off | Nejprve dokončete probíhající úkol — souběžný start je vypnutý | Nejprve dokončete probíhající úklid — souběžný start je vypnutý |  |
| `serverErrors.startTooEarly` | Задачу нельзя начать раньше {{time}} ({{date}}) | Уборку нельзя начать раньше {{time}} ({{date}}) | The task cannot start before {{time}} ({{date}}) | The cleaning cannot start before {{time}} ({{date}}) | Úkol nelze začít dříve než v {{time}} ({{date}}) | Úklid nelze začít dříve než v {{time}} ({{date}}) |  |
| `serverErrors.problemNotFound` | Проблема не найдена | Задание не найдено | Problem not found | Task not found | Problém nenalezen | Úkol nenalezen | «найдена» → «найдено» |
| `serverErrors.problemNotOpen` | Проблему уже взяли в работу — изменить её нельзя | Задание уже взяли в работу — изменить его нельзя | The problem has been picked up — it can no longer be changed | The task has been picked up — it can no longer be changed | Problém už někdo převzal — nelze ho změnit | Úkol už někdo převzal — nelze ho změnit | «её» → «его»; совпадает с `problems.notEditable` |
| `serverErrors.problemArchived` | Проблема в архиве — верните её из архива, прежде чем назначать | Задание в архиве — верните его из архива, прежде чем назначать | The problem is in the archive — restore it before handing it out | The task is in the archive — restore it before handing it out | Problém je v archivu — před přidělením ho obnovte | Úkol je v archivu — před přidělením ho obnovte | «её» → «его» |
| `serverErrors.taskChangedMeanwhile` | Задача уже изменилась — экран обновлён | Это уже изменилось — экран обновлён | The task has changed in the meantime — the screen has been refreshed | This has changed in the meantime — the screen has been refreshed | Úkol se mezitím změnil — obrazovka byla obnovena | Mezitím se to změnilo — obrazovka byla obnovena | одна фраза на два экрана: отмена уборки (`features/tasks/api.ts`) и снятие техника с задания (`features/problems/api.ts`, через `cancelLiveTask`) — одно существительное не подходит обоим, поэтому подлежащее нейтральное |
| `serverErrors.problemNoProperty` | У проблемы нет объекта — назначить нельзя | У задания нет объекта — назначить нельзя | The problem has no listing — it cannot be assigned | The task has no listing — it cannot be assigned | Problém nemá objekt — nelze ho přidělit | Úkol nemá objekt — nelze ho přidělit |  |
| `serverErrors.taskNotFound` | Задача не найдена | Уборка не найдена | Task not found | Cleaning not found | Úkol nenalezen | Úklid nenalezen | поднимает `resolve_report_property`: задание заводят с уборки, которой уже нет |
| `serverErrors.stepNotFound` | Шаг не найден или задача уже не в работе | Шаг не найден или уборка уже не в работе | The step was not found, or the task is no longer in progress | The step was not found, or the cleaning is no longer in progress | Krok nebyl nalezen nebo úkol již neprobíhá | Krok nebyl nalezen nebo úklid již neprobíhá |  |
| `serverErrors.taskClosed` | Задача уже закрыта ({{status}}) | Уборка уже закрыта ({{status}}) | The task is already closed ({{status}}) | The cleaning is already closed ({{status}}) | Úkol je již uzavřen ({{status}}) | Úklid je již uzavřen ({{status}}) | поднимает `guard_task_fields` — видит и техник на ремонте, вопрос 1 |
| `serverErrors.taskDateRequired` | У задания должен быть день | У уборки должен быть день | A task needs a day | A cleaning needs a day | Úkol musí mít den | Úklid musí mít den |  |
| `serverErrors.taskDuplicate` | На {{date}} в этой квартире такое задание уже есть | На {{date}} в этой квартире такая уборка уже есть | This flat already has such a task on {{date}} | This flat already has such a cleaning on {{date}} | Tento byt už na {{date}} takový úkol má | Tento byt už na {{date}} takový úklid má | «такое» → «такая» |
| `serverErrors.taskMovedMeanwhile` | Пока форма была открыта, задание перенесли на {{date}}. Откройте его заново. | Пока форма была открыта, уборку перенесли на {{date}}. Откройте её заново. | While the form was open, the task was moved to {{date}}. Open it again. | While the form was open, the cleaning was moved to {{date}}. Open it again. | Zatímco byl formulář otevřený, úkol se přesunul na {{date}}. Otevřete ho znovu. | Zatímco byl formulář otevřený, úklid se přesunul na {{date}}. Otevřete ho znovu. | «его» → «её» |

## 3. Чешский — для носителя

Одна строка на ключ: было → стало, затем падеж или причина. Формы множественного у `panel.calendar.moreTasks` и выбор *splněný* вместо *vyřešený* — главное, что стоит проверить.

- `panel.nav.problems`: Problémy → Úkoly — 1. pád mn. č.
- `panel.nav.tasks`: Úkoly → Úklidy — 1. pád mn. č.
- `panel.tasks.title`: Úkoly → Úklidy — 1. pád mn. č.
- `panel.tasks.loading`: Načítáme úkoly… → Načítáme úklidy… — 4. pád mn. č.
- `panel.tasks.loadError`: Úkoly se nepodařilo načíst → Úklidy se nepodařilo načíst — 4. pád mn. č. (předmět infinitivu)
- `panel.tasks.empty`: Zatím žádné úkoly → Zatím žádné úklidy — 1. pád mn. č.
- `panel.tasks.statuses.assigned`: Přiděleno — без изменений („Přiděleno“ je neosobní střední rod)
- `panel.tasks.statuses.accepted`: Přijato — без изменений
- `panel.tasks.statuses.blocked`: Blokováno — без изменений
- `panel.tasks.statuses.done`: Hotovo — без изменений
- `panel.tasks.statuses.cancelled`: Zrušeno — без изменений
- `panel.tasks.statuses.expired`: Propadlo — без изменений
- `panel.tasks.overdue`: Propadlo — без изменений
- `panel.tasks.origin.problem`: Z problému → Z úkolu — 2. pád j. č. (z úkolu)
- `panel.tasks.actions.new`: Nový úkol → Nový úklid — 1. pád j. č.
- `panel.tasks.actions.cancel`: Zrušit úkol → Zrušit úklid — 4. pád j. č.
- `panel.tasks.actions.cancelConfirm`: Zrušit tento úkol? Zůstane v historii. → Zrušit tento úklid? Zůstane v historii. — 4. pád j. č.; „zůstane“ beze změny
- `panel.tasks.form.titleNew`: Nový úkol → Nový úklid — 1. pád j. č.
- `panel.tasks.form.titleEdit`: Upravit úkol → Upravit úklid — 4. pád j. č.
- `panel.tasks.form.description`: Volitelné: bez názvu se úkol jmenuje podle svého druhu — „Úklid“, „Kontrola“. → Volitelné: bez názvu se ukáže druh — „Úklid“, „Kontrola“. — podstatné jméno vypuštěno („úklid se jmenuje „Kontrola““ by si odporovalo)
- `panel.tasks.form.type`: Druh úkolu → Druh — podstatné jméno vypuštěno, jako u filtru „Druh“; doslovně „Druh úklidu“
- `panel.tasks.form.assigneeRequired`: Kontrola a údržba musí mít přiřazeného pracovníka: vyberte, kdo úkol udělá. → Kontrola a údržba musí mít přiřazeného pracovníka: vyberte, kdo práci udělá. — 4. pád j. č. (práci)
- `panel.tasks.form.generatedHint`: Úkol vznikl z rezervace nebo z problému: byt ani druh nelze změnit. → Úklid vznikl z rezervace nebo z úkolu: byt ani druh nelze změnit. — 1. pád j. č. (úklid vznikl); z úkolu — 2. pád
- `panel.tasks.work.titleOpen`: Úkol → Úklid — 1. pád j. č.
- `panel.tasks.work.noSteps`: Úkol neměl žádné kroky → Úklid neměl žádné kroky — 1. pád j. č.; „neměl“ beze změny (mužský rod)
- `panel.tasks.work.problems`: Problémy z tohoto úklidu → Úkoly z tohoto úklidu — 1. pád mn. č.
- `panel.tasks.work.noProblems`: Žádné problémy nebyly nahlášeny → Žádné úkoly nebyly nahlášeny — 1. pád mn. č.
- `panel.problems.title`: Problémy → Úkoly — 1. pád mn. č.
- `panel.problems.empty`: Žádné problémy → Žádné úkoly — 1. pád mn. č.
- `panel.problems.loading`: Načítáme problémy… → Načítáme úkoly… — 4. pád mn. č.
- `panel.problems.loadError`: Problémy se nepodařilo načíst → Úkoly se nepodařilo načíst — 4. pád mn. č. (předmět infinitivu)
- `panel.problems.notFound`: Problém nenalezen → Úkol nenalezen — 1. pád j. č.; „nenalezen“ beze změny
- `panel.problems.columns.title`: Problém → Úkol — 1. pád j. č.
- `panel.problems.columns.reported`: Nahlášeno — без изменений („Nahlášeno“ je neosobní)
- `panel.problems.detail.back`: Zpět na problémy → Zpět na úkoly — 4. pád mn. č. (na úkoly)
- `panel.problems.detail.reportedAt`: Nahlášeno {{date}} — без изменений
- `panel.problems.detail.fromTask`: Nalezeno během úklidu — без изменений („Nalezeno“ je neosobní)
- `panel.problems.detail.fixTask`: Úkol opravy → Práce technika — 1. pád j. č. (práce), technika — 2. pád
- `panel.problems.detail.steps`: Kroky úkolu → Kroky práce — 2. pád j. č. (práce)
- `panel.problems.detail.noSteps`: Kroky se objeví, až technik úkol zahájí → Kroky se objeví, až technik zahájí práci — 4. pád j. č. (práci)
- `panel.problems.detail.resolvedAt`: Vyřešeno {{date}} → Splněno {{date}} — neosobní střední rod; sloveso splnit
- `panel.problems.detail.cancelledAt`: Zrušeno {{date}} — без изменений
- `panel.problems.detail.taskStatus`: Stav úkolu: {{status}} → Stav práce: {{status}} — 2. pád j. č. (práce)
- `panel.problems.assign.noProperty`: Problém nemá objekt, úkol proto nelze naplánovat → Úkol nemá objekt, práci proto nelze naplánovat — 1. pád j. č. (úkol); práci — 4. pád
- `panel.problems.actions.resolve`: Označit jako vyřešený → Označit jako splněný — 1. pád j. č. m. r. (jako splněný)
- `panel.problems.actions.cancel`: Zrušit problém → Zrušit úkol — 4. pád j. č.
- `panel.problems.actions.archiveText`: Problém zmizí z nástěnky, ze seznamu i z aplikací zaměstnanců. Nic se nemaže: lze ho vrátit ze záložky Archiv. → Úkol zmizí z nástěnky, ze seznamu i z aplikací zaměstnanců. Nic se nemaže: lze ho vrátit ze záložky Archiv. — 1. pád j. č.; „ho“ beze změny
- `panel.problems.board.startOnPhone`: Do práce problém převádí technik, když úkol zahájí v aplikaci → Do práce úkol převádí technik tlačítkem „Začít práci“ v aplikaci — 4. pád j. č. (úkol); název tlačítka z `tasks.work.start`
- `panel.problems.board.unassigned`: Úkol technika je zrušen, problém je znovu otevřený → Práce technika je zrušena, úkol je znovu otevřený — práce (ž. r.) → „zrušena“; úkol → „otevřený“ beze změny
- `panel.problems.board.resolveTitle`: Označit jako vyřešený? → Označit jako splněný? — jako splněný — m. r.
- `panel.problems.board.resolveText`: „{{title}}“ se uzavře jako vyřešený. Úkol technika, pokud existuje, bude dokončen. → „{{title}}“ se uzavře jako splněný. Práce technika, pokud existuje, bude dokončena. — jako splněný (m. r., úkol); práce → „dokončena“ (ž. r.)
- `panel.problems.board.resolveConfirm`: Ano, vyřešeno → Ano, splněno — neosobní střední rod
- `panel.problems.board.reopened`: Problém je znovu otevřený → Úkol je znovu otevřený — 1. pád j. č.; „otevřený“ beze změny
- `panel.problems.board.columnEmpty`: ✨ Zatím žádné problémy → ✨ Zatím žádné úkoly — 1. pád mn. č.
- `panel.problems.archive.hint`: Archivované problémy zaměstnanci nevidí a na nástěnce nejsou. Obnovený problém se vrátí ve stejném stavu. → Archivované úkoly zaměstnanci nevidí a na nástěnce nejsou. Obnovený úkol se vrátí ve stejném stavu. — 4. pád mn. č.; 1. pád j. č.
- `panel.calendar.moreTasks_one`: Ještě {{count}} úkol → Ještě {{count}} úklid — 1. pád j. č. (1)
- `panel.calendar.moreTasks_few`: Ještě {{count}} úkoly → Ještě {{count}} úklidy — 1. pád mn. č. (2–4)
- `panel.calendar.moreTasks_many`: Ještě {{count}} úkolu → Ještě {{count}} úklidu — 2. pád j. č. (desetinná čísla)
- `panel.calendar.moreTasks_other`: Ještě {{count}} úkolů → Ještě {{count}} úklidů — 2. pád mn. č. (5 a více)
- `panel.calendar.loadingTasks`: Načítáme úkoly… → Načítáme úklidy… — 4. pád mn. č.
- `panel.calendar.tasksError`: Úkoly se nepodařilo načíst. → Úklidy se nepodařilo načíst. — 4. pád mn. č. (předmět infinitivu)
- `panel.calendar.filters.open`: Otevřené — без изменений („Otevřené“)
- `panel.calendar.filters.done`: Hotovo — без изменений
- `panel.calendar.filters.nobody`: Nepřiřazeno — без изменений („Nepřiřazeno“)
- `panel.calendar.stand.newTask`: Nový úkol: {{place}}, {{day}} → Nový úklid: {{place}}, {{day}} — 1. pád j. č.
- `panel.calendar.expiredMark`: Neproběhlo — без изменений
- `panel.calendar.overdue`: Po termínu — без изменений
- `panel.calendar.chipView`: Zobrazení úkolů → Zobrazení úklidů — 2. pád mn. č.
- `panel.calendar.expiredError`: Neproběhlé úkoly se nepodařilo načíst. → Neproběhlé úklidy se nepodařilo načíst. — 4. pád mn. č. (předmět infinitivu)
- `panel.calendar.cancelledError`: Zrušené úkoly se nepodařilo načíst. → Zrušené úklidy se nepodařilo načíst. — 4. pád mn. č. (předmět infinitivu)
- `panel.calendar.taskMissing`: Úkol se nepodařilo otevřít. → Úklid se nepodařilo otevřít. — 4. pád j. č. (předmět infinitivu)
- `panel.settings.galleryHint`: Vypnuto: fotky a video se pořizují jen fotoaparátem a přímo na místě. Zapnuto: uklízečka může přiložit hotový soubor z galerie — i pořízený v jiném bytě nebo před týdnem, a pak médium přestává být důkazem o stavu bytu v době úklidu. Platí pro úklidy i pro řešení problémů. → Vypnuto: fotky a video se pořizují jen fotoaparátem a přímo na místě. Zapnuto: uklízečka může přiložit hotový soubor z galerie — i pořízený v jiném bytě nebo před týdnem, a pak médium přestává být důkazem o stavu bytu v době úklidu. Platí pro úklidy i pro úkoly. — 4. pád mn. č. (pro úkoly)
- `panel.settings.workflow.runningNote`: Úprava se nedotkne úkolů, které už běží: každý jde podle snímku pořízeného při startu. → Úprava se nedotkne úklidů, které už běží: každý jde podle snímku pořízeného při startu. — 2. pád mn. č.; „každý“ beze změny
- `panel.settings.workflow.scopes.problem`: Řešení problémů → Práce na úkolech — 6. pád mn. č. (na úkolech)
- `panel.settings.workflow.none`: Pro tento druh úkolu zatím proces není. Přidejte kroky a uložte. → Pro tento druh zatím proces není. Přidejte kroky a uložte. — podstatné jméno vypuštěno
- `panel.settings.workflow.stepTypes.task_note`: Poznámka k úkolu → Poznámka k úklidu — 3. pád j. č. (k úklidu)
- `panel.team.form.propertiesHint`: Zaměstnanec vidí úkoly jen u objektů, které jsou tu zaškrtnuté. → Zaměstnanec vidí úklidy jen u objektů, které jsou tu zaškrtnuté. — 4. pád mn. č.
- `panel.team.links.description`: „Napevno“ přiřadí úkol hned, jak vznikne. „Z fronty“ ho nechá tomu, kdo si ho vezme první. → „Napevno“ přiřadí úklid hned, jak vznikne. „Z fronty“ ho nechá tomu, kdo si ho vezme první. — 4. pád j. č.; „ho“ beze změny
- `panel.chat.audienceTask`: Vidí ti, kdo vidí úkol: přidělený pracovník, uklízečky objektu a manažeři → Vidí ti, kdo vidí úklid: přidělený pracovník, uklízečky objektu a manažeři — 4. pád j. č.
- `panel.chat.audienceProblem`: Vidí ti, kdo vidí závadu: kdo ji nahlásil, technik a manažeři — без изменений („závadu“ je synonymum, ne název sekce)
- `panel.dashboard.emptyHint`: Čísla přijdou spolu se sekcemi. Začněte problémy a žádostmi o materiál. → Čísla přijdou spolu se sekcemi. Začněte úkoly a žádostmi o materiál. — 7. pád mn. č. (začněte čím: úkoly)
- `panel.apartments.info.cleanerNotesHint`: Zobrazí se v aplikaci u úkolu. → Zobrazí se v aplikaci u úklidu. — 2. pád j. č. (u úklidu)
- `tabs.myTasks`: Moje úkoly → Moje úklidy — 1. pád mn. č.
- `tabs.problems`: Problémy → Úkoly — 1. pád mn. č.
- `tasks.loading`: Načítáme úkoly… → Načítáme úklidy… — 4. pád mn. č.
- `tasks.loadFailed`: Úkoly se nepodařilo načíst → Úklidy se nepodařilo načíst — 4. pád mn. č. (předmět infinitivu)
- `tasks.emptyMine`: Zatím vám nebyl přidělen žádný úkol. Podívejte se do „Volné“ — na vašich objektech může být práce. → Zatím vám nebyl přidělen žádný úklid. Podívejte se do „Volné“ — na vašich objektech může být práce. — 1. pád j. č.; „žádný“, „přidělen“ beze změny
- `tasks.claimFailedTitle`: Úkol se nepodařilo vzít → Úklid se nepodařilo vzít — 4. pád j. č. (předmět infinitivu)
- `tasks.claimTaken`: Úkol si už někdo vzal, nebo už vypršel. → Úklid si už někdo vzal, nebo už vypršel. — 4. pád j. č.; „vypršel“ beze změny
- `tasks.startFailed`: Úkol se nepodařilo začít — obnovte seznam. → Úklid se nepodařilo začít — obnovte seznam. — 4. pád j. č. (předmět infinitivu)
- `tasks.finishFailed`: Úkol se nepodařilo dokončit — obnovte seznam. → Úklid se nepodařilo dokončit — obnovte seznam. — 4. pád j. č. (předmět infinitivu)
- `tasks.detail.startedAt`: Začátek — без изменений
- `tasks.detail.completedAt`: Konec — без изменений
- `tasks.detail.parallel`: Probíhal souběžně s jiným úkolem → Probíhal souběžně s jiným úklidem — 7. pád j. č. (s jiným úklidem)
- `tasks.detail.closed`: Úkol je uzavřen → Úklid je uzavřen — 1. pád j. č.
- `tasks.detail.reportProblem`: Nahlásit problém → Vytvořit úkol — 4. pád j. č.
- `tasks.detail.problem`: Problém → Úkol — 1. pád j. č.
- `tasks.detail.openProblem`: Otevřít problém → Otevřít úkol — 4. pád j. č.
- `tasks.detail.notFound`: Úkol nenalezen, nebo už není váš → Úklid nenalezen, nebo už není váš — 1. pád j. č.; „váš“ beze změny
- `steps.types.task_note`: Pokyny k úkolu → Pokyny k úklidu — 3. pád j. č. (k úklidu)
- `steps.commentPlaceholder`: Co by měla kancelář vědět o tomto úkolu… → Co by měla kancelář vědět o tomto úklidu… — 6. pád j. č. (o tomto úklidu)
- `steps.readOnly`: Kroky lze měnit, jen dokud úkol probíhá → Kroky lze měnit, jen dokud úklid probíhá — 1. pád j. č.
- `problems.report`: Nahlásit problém → Vytvořit úkol — 4. pád j. č.
- `problems.new`: Nový problém → Nový úkol — 1. pád j. č.
- `problems.one`: Problém → Úkol — 1. pád j. č.
- `problems.loading`: Načítáme problémy… → Načítáme úkoly… — 4. pád mn. č.
- `problems.emptyMine`: Žádné nahlášené problémy → Žádné nahlášené úkoly — 1. pád mn. č.
- `problems.notFound`: Problém nenalezen → Úkol nenalezen — 1. pád j. č.
- `problems.notEditable`: Problém už někdo převzal — nelze ho změnit → Úkol už někdo převzal — nelze ho změnit — 4. pád j. č.; „ho“ beze změny
- `problems.statuses.open`: Otevřený — без изменений („Otevřený“ (m. r., úkol))
- `problems.statuses.assigned`: Přidělený — без изменений („Přidělený“)
- `problems.statuses.resolved`: Vyřešený → Splněný — m. r. (úkol); splnit úkol místo vyřešit problém
- `problems.statuses.cancelled`: Zrušený — без изменений („Zrušený“)
- `problems.openFixTask`: Otevřít úkol opravy → Otevřít práci technika — 4. pád j. č. (práci)
- `serverErrors.parallelStartOff`: Nejprve dokončete probíhající úkol — souběžný start je vypnutý → Nejprve dokončete probíhající úklid — souběžný start je vypnutý — 4. pád j. č.
- `serverErrors.startTooEarly`: Úkol nelze začít dříve než v {{time}} ({{date}}) → Úklid nelze začít dříve než v {{time}} ({{date}}) — 4. pád j. č. (předmět infinitivu)
- `serverErrors.problemNotFound`: Problém nenalezen → Úkol nenalezen — 1. pád j. č.
- `serverErrors.problemNotOpen`: Problém už někdo převzal — nelze ho změnit → Úkol už někdo převzal — nelze ho změnit — 4. pád j. č.
- `serverErrors.problemArchived`: Problém je v archivu — před přidělením ho obnovte → Úkol je v archivu — před přidělením ho obnovte — 1. pád j. č.; „ho“ beze změny
- `serverErrors.taskChangedMeanwhile`: Úkol se mezitím změnil — obrazovka byla obnovena → Mezitím se to změnilo — obrazovka byla obnovena — podstatné jméno vypuštěno („to“)
- `serverErrors.problemNoProperty`: Problém nemá objekt — nelze ho přidělit → Úkol nemá objekt — nelze ho přidělit — 1. pád j. č.
- `serverErrors.taskNotFound`: Úkol nenalezen → Úklid nenalezen — 1. pád j. č.
- `serverErrors.stepNotFound`: Krok nebyl nalezen nebo úkol již neprobíhá → Krok nebyl nalezen nebo úklid již neprobíhá — 1. pád j. č.
- `serverErrors.taskClosed`: Úkol je již uzavřen ({{status}}) → Úklid je již uzavřen ({{status}}) — 1. pád j. č.
- `serverErrors.taskDateRequired`: Úkol musí mít den → Úklid musí mít den — 1. pád j. č.
- `serverErrors.taskDuplicate`: Tento byt už na {{date}} takový úkol má → Tento byt už na {{date}} takový úklid má — 4. pád j. č.; „takový“ beze změny
- `serverErrors.taskMovedMeanwhile`: Zatímco byl formulář otevřený, úkol se přesunul na {{date}}. Otevřete ho znovu. → Zatímco byl formulář otevřený, úklid se přesunul na {{date}}. Otevřete ho znovu. — 1. pád j. č.; „ho“ beze změny

## 4. Строки вне локалей и синонимы рядом

### Строки вне локалей

Литералов, которые называют разделы, в `apps/web/src` и `apps/mobile/src` (без тестов) нет — ни русских, ни чешских, ни английских. Edge Functions и шаблон письма `supabase/templates/recovery.html` разделов тоже не называют. Нашлось другое:

1. **`apps/web/src/features/problems/problem-detail.tsx:258`** — статус работы техника берётся ключом `tasks.statuses.${status}` с `defaultValue: status`. Ключей `tasks.statuses.*` нет ни в одном языке (есть `panel.tasks.statuses.*` и `tasks.status.inProgress`), поэтому менеджер сейчас видит сырой код: «Статус задачи: assigned», «Статус задачи: in_progress». Это видимый английский литерал прямо в переименованной строке `panel.problems.detail.taskStatus`. Правка — ключ `panel.tasks.statuses.*`; после переименования выйдет «Статус работы: Назначена». В черновик не входит: код не трогаю.
2. Комментарии, которые цитируют старый текст; пользователь их не видит, по правилу CLAUDE.md они обновляются при следующей правке файла: `apps/web/src/features/calendar/row-track.tsx:73` («Новое задание»), `apps/web/src/features/calendar/task-chips.tsx:116` («Просрочено» — станет «Просрочена»), `apps/mobile/src/i18n/index.ts:1–3` (пример чешских форм «1 úkol, 2 úkoly, 5 úkolů» — иллюстрация правил множественного числа, раздел не называет).
3. К переименованию не относится, но тоже непереведённый литерал: `sr-only` «Close» в `apps/web/src/components/ui/dialog.tsx:75` и `apps/web/src/components/ui/sheet.tsx:75`.
4. Адресная строка браузера по-прежнему покажет `/tasks` и `/problems`: маршруты по решению владельца не меняются.

Тесты. Старые слова встречаются в 36 тестовых файлах панели и телефона (больше всего — `apps/web/src/features/calendar/__tests__/calendar-view.test.tsx`, затем `tasks-view.test.tsx`, `task-form.test.tsx`, `sidebar.test.tsx`, `problems-board.test.tsx`, `problem-detail.test.tsx`). Какие из совпадений — видимый текст, а какие — английские сообщения в моках, по одному не проверено; их правят вместе с локалями.

### Синонимы рядом

По правилу поломка, неполадка, ремонт, осмотр, работа (breakdown, repair, inspection, maintenance, job, work; porucha, závada, oprava, kontrola, údržba, práce) остаются, если не называют раздел. «Неполадка», «breakdown» и «porucha» в локалях не встречаются. Где синонимы стоят рядом с переименованными словами:

| ключ | синоним | что с ним |
|---|---|---|
| `panel.chat.audienceProblem` | ru «поломка», cs «závadu» — называют задание, к которому чат | остаются по правилу; en меняется (problem → task). Вопрос 6 |
| `panel.tasks.form.description` | «Осмотр» / “Inspection” / „Kontrola“ — имя вида | остаётся |
| `panel.tasks.form.assigneeRequired` | «Осмотру и обслуживанию» / “an inspection or a maintenance job” / „Kontrola a údržba“ | остаются; «задание» в той же строке → «работу» |
| `panel.team.links.description` | en “job” | остаётся; ru и cs → «уборка», „úklid“ |
| `tasks.emptyMine` | «работа» / “work” / „práce“ — «там может быть работа на ваших объектах» | остаётся |
| `panel.problems.board.startOnPhone`, `problems.notEditable`, `serverErrors.problemNotOpen`, `steps.readOnly`, `serverErrors.stepNotFound` | «в работу», «в работе» / “in progress”, “picked up” / „do práce“, „probíhá“ — состояние, не сущность | остаются |
| `panel.settings.workflow.scopes.problem`, `panel.problems.detail.fixTask`, `problems.openFixTask`, `panel.settings.galleryHint` | «устранение» / “fix”, “fixing” / „oprava“, „řešení“ | уходят вместе со старым словом: «работа по заданию», «работа техника» |
| `panel.settings.workflow.scopes.inspection`, `panel.tasks.types.*`, `tasks.kinds.*` | «Осмотры», «Осмотр», «Обслуживание» / Inspection, Maintenance / Kontrola, Údržba | имена видов, остаются |

Где синоним называет ту же сущность, что раздел «Задания», хотя переименованного слова рядом нет:

- `panel.apartments.maintenance.reports` и `noReports` — «Репорты (открытых: {{open}})», «Репортов нет.» / “Reports” / „Hlášení“: список заданий на вкладке «Обслуживание» карточки объекта, каждая строка ведёт на `/problems/:id`.
- `panel.chat.audienceProblem` — «поломка» / „závada“ (выше).
- `panel.calendar.repairsError` — «Не удалось загрузить ремонты.» / “repairs” / „Opravy“, и бейдж `panel.calendar.overdue` «Просрочен» — календарь называет ремонтом работу техника по заданию.
- Работа техника под именем «работа» — `panel.apartments.maintenance.jobs` «Работы техников», `noJobs`, `tasks.work.*`: на них опирается выбор слова «работа» (вопрос 4).

## 5. Вопросы владельцу

1. **«Уборка» для осмотра и ремонта.** Раздел «Уборки» по решению включает осмотры и ремонты, и общие слова становятся «уборкой» и там, где речь об осмотре или ремонте: кнопки «Новая уборка» (`panel.tasks.actions.new`, `panel.tasks.form.titleNew`, `panel.calendar.stand.newTask`), заголовок окна «Уборка» (`panel.tasks.work.titleOpen`), шаг «Заметка к уборке» / «Указания к уборке» (`panel.settings.workflow.stepTypes.task_note`, `steps.types.task_note`), ошибки, которые видит техник: «Не удалось начать уборку» (`tasks.startFailed`, `tasks.finishFailed`), «Уборка уже закрыта» (`serverErrors.taskClosed`). Черновик ставит «уборку» везде, как решено. Оставить так — или в строках, которые читает техник, писать без существительного («Не удалось начать — обновите список»)?
2. **Глагол для сделанного задания:** «Выполнено» / “Done” / „Splněný“. Другие варианты: «Закрыто» или «Сделано»; “Completed”; „Hotový“ или прежнее „Vyřešený“.
3. **Вкладка телефона:** «Мои уборки» / “My cleanings” / „Moje úklidy“. У техника в этой вкладке ремонты. Варианты: «Мои уборки», просто «Уборки», «Моя работа».
4. **Работа техника по заданию — «работа»** («Работа техника», «Шаги работы», «Статус работы», процесс «Работы по заданиям»; en job, cs práce), как уже пишут телефон и карточка объекта. Второй вариант — дословная «уборка» («Уборка техника отменена, задание снова открыто»).
5. **Кнопка горничной:** «Создать задание» / “Create a task” / „Vytvořit úkol“ вместо «Сообщить о проблеме» (`problems.report`, `tasks.detail.reportProblem`). Или оставить «Сообщить о проблеме» как обычные слова — тогда «проблема» остаётся в интерфейсе в бытовом смысле рядом с разделом «Задания».
6. **Синонимы, которые называют задание:** «Репорты (открытых: N)» на карточке объекта, «поломка» / „závada“ в подписи чата задания (en при этом становится “task”), «ремонты» в календаре. По правилу остаются. Сводить ли их к «заданиям»?
