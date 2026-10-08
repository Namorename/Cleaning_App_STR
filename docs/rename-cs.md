# Чешские тексты после переименований — на проверку носителем

Сюда пишутся чешские строки, которые изменились по решению владельца о словаре и
где перевод выбран без носителя языка. Носитель отмечает строку «ок» или пишет
свой вариант; правка — в `packages/shared/src/i18n/locales/cs.json` по тому же ключу.

## «Разговор» → «Чат» (решение владельца 2026-10-08)

Во всём интерфейсе панели «Разговор» стал «Чат» (ru «Чат», en «Chat», cs «Chat»);
ключи i18n не менялись. В чешском слово сменило род: «konverzace» — женский,
«chat» — мужской, поэтому вместе со словом поменялись местоимение и окончания.

| Ключ | Было | Стало | Что проверить |
|---|---|---|---|
| `panel.chat.title` | Konverzace | Chat | заголовок шторки; с заглавной — как прочие заголовки |
| `panel.chat.open` | Konverzace | Chat | кнопка в шапке задания и пункт меню «⋯» строки уборки |
| `panel.chat.openUnread` | Nová zpráva — otevřít konverzaci: {{about}} | Nová zpráva — otevřít chat: {{about}} | имя метки для чтеца экрана; винительный «chat» |
| `panel.chat.loading` | Načítáme konverzaci… | Načítáme chat… | винительный «chat» |
| `panel.chat.loadError` | Konverzaci se nepodařilo otevřít | Chat se nepodařilo otevřít | порядок слов |
| `serverErrors.threadSubjectInvalid` | Konverzace se týká právě jedné věci | Chat se týká právě jedné věci | звучит ли «chat se týká» естественно |
| `serverErrors.threadNotFound` | Tato konverzace není dostupná | Tento chat není dostupný | род: tento / dostupný; совпадает с `chat.notFound` телефона |

Телефон уже говорил «Chat» (`chat.title`, `chat.notFound` «Tento chat není dostupný»,
`tasks.detail.openChat`, `problems.openChat`, «Zpráva v chatu») — эти строки не менялись
и тоже годятся для сверки.
