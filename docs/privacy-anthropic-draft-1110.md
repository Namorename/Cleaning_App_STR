# Anthropic в реестре обработчиков и на странице политики — черновик (10.11)

**Не опубликовано.** Это текст правки для владельца. Страница `/privacy` и ключи `privacy.*` не
менялись. Публикация (правка ключей в трёх языках, `privacy-policy.tsx`, тест
`privacy-page.test.tsx`, `effectiveDate`) делается только словом владельца об изменении страницы
политики.

`/privacy` — политика для сотрудников (решение 17). Уведомление гостям отложено и выключено 01.11, так
что эта правка гостей не уведомляет. Она делает три вещи:
- называет Anthropic обработчиком;
- говорит сотрудникам, что происходит с их именами в текстах гостей;
- говорит, что модель не читает их собственные тексты (решение 06.11).

Пометка **[ПРОВЕРИТЬ]** стоит у фактов, которые нужно сверить с действующими условиями Anthropic
перед публикацией.

## 1. Где что меняется

| Место | Сейчас | Правка |
|---|---|---|
| `docs/privacy-dpa-links.md`, таблица DPA | Supabase, Vercel, Expo, Sentry; Anthropic нет (пункт 21 плана). Строка 10 устарела: «Vercel Pro оплачен», хотя сейчас Hobby | строка Anthropic и блок под ней (ниже); строку 10 исправить |
| `privacy.recipients.vendors.*` и `vendorRows` в `privacy-policy.tsx` | шесть поставщиков | `vendors.anthropic` в трёх языках |
| `privacy.recipients.terms` | «С Supabase, Vercel, Expo и Sentry — {{agreements}}…» | добавить фразу про Anthropic (ниже); тест `privacy-page.test.tsx:132` сверяет строку |
| `privacy.recipients.transfers` | «…основание проверено для каждого поставщика» | не меняется, но это утверждение станет правдой для Anthropic только после сверки (п. 3) |
| новый `privacy.data.guestTexts` | о текстах гостей на странице ничего нет | абзац (ниже) в разделе данных |
| раздел 5, срок хранения (по желанию) | — | строка «Тексты отзывов гостей» |

`privacy.basis.*` не трогается: новое правовое основание не заявляется. Строка «нет автоматизированных
решений с правовыми последствиями» остаётся верной.

## 2. Текст

**Строка поставщика (Поставщик | Что делает | Где):**
- ru: Anthropic | разбор текстов отзывов гостей искусственным интеллектом после удаления имён,
  контактов и кодов | США [ПРОВЕРИТЬ]
- en: Anthropic | AI analysis of guest review texts, after names, contacts and codes are removed | USA
  [VERIFY]
- cs: Anthropic | analýza textů recenzí hostů umělou inteligencí, po odstranění jmen, kontaktů a kódů |
  USA [VERIFY]

После «включай чаты» роль поставщика расширяется: «…отзывов гостей и их сообщений во время проживания…»
/ «…of guest reviews and of guests' messages during a stay…» / «…recenzí hostů a jejich zpráv během
pobytu…».

**Фраза к `privacy.recipients.terms`:**
- ru: «У Anthropic условия обработки данных входят в её Commercial Terms [ПРОВЕРИТЬ]; на этих текстах
  она не обучает свои модели.»
- en: «For Anthropic, the data processing terms are part of its Commercial Terms [VERIFY]; it does not
  train its models on the texts.»
- cs: «U společnosti Anthropic jsou podmínky zpracování údajů součástí jejích Commercial Terms [VERIFY];
  texty nepoužívá k trénování svých modelů.»

**Абзац `privacy.data.guestTexts`:**

ru: «<b>Отзывы и сообщения гостей.</b> Отзывы гостей с площадок бронирования разбирает языковая модель
искусственного интеллекта (Claude компании Anthropic), чтобы находить неисправности в квартирах. Гость
может упомянуть вас по имени: до того как текст сохранится или уйдёт модели, имена гостей и
сотрудников, контакты, ссылки и числа от четырёх цифр заменяются метками. Модель получает только этот
текст — ни вашу учётную запись, ни ваши рабочие данные, — и того, что вы пишете в приложении, она не
читает. Она лишь отмечает возможную неисправность (тему, срочность и уверенность); что делать, решает
менеджер, а оценок отдельных сотрудников по текстам гостей система не строит. Тексты отзывов с
заменёнными именами храним не дольше 18 месяцев. Anthropic удаляет полученные тексты в течение 30 дней
— дольше, только если её системы безопасности отметят текст как нарушающий правила использования
[ПРОВЕРИТЬ].»

en: «<b>Guest reviews and messages.</b> Guests' reviews from the booking platforms are analysed by an AI
language model (Anthropic's Claude) to find faults in the apartments. A guest may mention you by name:
before a text is stored or sent to the model, the names of guests and staff, contacts, links and numbers
of four digits or more are replaced by placeholders. The model gets only this text — never your account
or your work data — and it does not read anything you write in the app. It only marks a possible fault
(its theme, urgency and how sure it is); a manager decides what to do, and the system builds no ratings
of individual employees from guests' texts. We keep review texts, with the names already replaced, for
at most 18 months. Anthropic deletes the texts it receives within 30 days, longer only if its safety
systems flag a text as breaking its usage policy [VERIFY].»

cs: «<b>Recenze a zprávy hostů.</b> Recenze hostů z rezervačních platforem analyzuje jazykový model
umělé inteligence (Claude od společnosti Anthropic), aby se našly poruchy v bytech. Host vás může
zmínit jménem: než se text uloží nebo odešle modelu, jména hostů a pracovníků, kontakty, odkazy a čísla
od čtyř číslic se nahradí zástupnými značkami. Model dostane jen tento text, nikdy váš účet ani vaše
pracovní údaje, a nečte nic, co píšete v aplikaci. Jen označí možnou poruchu (téma, naléhavost a
jistotu); o dalším postupu rozhoduje manažer a systém z textů hostů nehodnotí jednotlivé pracovníky.
Texty recenzí s nahrazenými jmény uchováváme nejvýše 18 měsíců. Anthropic přijaté texty maže do 30
dnů, déle jen tehdy, když je jeho bezpečnostní systémy označí za porušení pravidel používání [VERIFY].»

**Фраза про чаты** (условная, может выйти сейчас или вместе с «включай чаты»):
- ru: «Если компания включит разбор сообщений гостей, модель будет читать и сообщения, которые гости
  сами пишут во время проживания, — так же обезличенные и ещё без кодов дверей и номеров карт;
  сообщения компании гостям не отправляются никогда, а текст сообщений нигде не хранится.»
- en: «If the company turns on the reading of guests' messages, the model also reads the messages guests
  themselves write during their stay, treated the same way and also stripped of door codes and card
  numbers; the company's messages to guests are never sent, and no message text is stored.»
- cs: «Pokud společnost zapne čtení zpráv hostů, model čte také zprávy, které hosté sami napíší během
  pobytu, upravené stejně a navíc bez kódů ke dveřím a čísel karet; zprávy společnosti hostům se nikdy
  neodesílají a text zpráv se nikde neukládá.»

**Строка срока хранения (по желанию):** «Тексты отзывов гостей (имена заменены) — не дольше 18
месяцев; тексты сообщений гостей не хранятся» / «Guest review texts (names replaced) — at most 18
months; texts of guests' messages are not stored» / «Texty recenzí hostů (jména nahrazena) — nejvýše
18 měsíců; texty zpráv hostů se neukládají».

**Строка реестра `privacy-dpa-links.md`:**

| Обработчик | Договор | Где принят | Передача в США |
|---|---|---|---|
| Anthropic (Claude API, Claude Haiku 5.5; отзывы — с 04.11, чаты — после «включай чаты») | DPA входит в Commercial Terms (сверено 16.10) [ПРОВЕРИТЬ: принят от имени компании, юрлицо] | вместе с Commercial Terms, ключ API | SCC в DPA [ПРОВЕРИТЬ: DPF] |

Под таблицей:
- **Что уходит:**
  - обезличенный текст отзыва;
  - у чатов только сообщения гостя за дни проживания, ещё и без `[CODE]`/`[CARD]`/`[ID]`;
  - сообщения хозяина не уходят никогда.
- **Что храним:**
  - метки (тема, срочность, уверенность);
  - тексты новых отзывов — до 18 месяцев;
  - текст сообщений — нигде.
- **Срок хранения у Anthropic** [ПРОВЕРИТЬ]: 30 дней; отмеченное системами безопасности — до 2 лет,
  оценки безопасности — до 7 лет.

## 3. Открытые юридические вопросы (юрист не привлекался, решение владельца 06.11 и 10.11)

1. **Правовое основание** разбора отзывов и чатов не установлено. Рабочая гипотеза в документах —
   законный интерес (ст. 6(1)(f)) с тестом баланса. Текст выше основание не заявляет.
2. **Гости не уведомлены:** уведомление отложено 01.11. Для живых чатов это весомее, чем для отзывов.
3. **Условия Anthropic** сверялись 16.10. Перед публикацией и перед включением чатов сверить:
   - принят ли DPA от имени компании;
   - юрлицо;
   - SCC или DPF;
   - сроки хранения;
   - регион обработки.
   До сверки фраза «основание проверено для каждого поставщика» для Anthropic неверна.
4. **Облегчённая оценка рисков** (DPIA) систематического разбора чатов не написана.
5. **Возражение гостя:** метка «не разбирать эту бронь» (решение 13) для чатов не сделана.
6. **Сотрудники (§ 316 zákoníku práce):** имена заменяются, оценок нет. Но темы по объекту и месяцу
   можно вручную сопоставить с тем, кто убирал.
7. **Условия Airbnb и Booking** о разборе отзывов и сообщений через PMS не проверены.
8. **Мелочь:** строка 10 `privacy-dpa-links.md` и комментарий в `settings.ts` («Vercel Pro») устарели.
   Vercel Hobby по своим условиям — только для некоммерческого использования.
