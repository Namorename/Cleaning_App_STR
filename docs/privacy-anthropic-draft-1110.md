# Anthropic в реестре обработчиков и на странице политики — черновик (10.11, факты сверены 11.11)

**Не опубликовано.** Это текст правки для владельца. Страница `/privacy` и ключи `privacy.*` не
менялись. Публикация (правка ключей в трёх языках, `privacy-policy.tsx`, тест
`privacy-page.test.tsx`, `effectiveDate`) делается только словом владельца об изменении страницы
политики.

`/privacy` — политика для сотрудников (решение 17). Уведомление гостям отложено и выключено 01.11, так
что эта правка гостей не уведомляет. Она делает три вещи:
- называет Anthropic обработчиком;
- говорит сотрудникам, что происходит с их именами в текстах гостей;
- говорит, что модель не читает их собственные тексты (решение 06.11).

С 11.11 00:08 UTC чаты включены (слово владельца «включай чаты»), поэтому сообщения гостей в тексте
ниже — уже не условие, а факт.

## 0. Проверенные факты (официальные страницы Anthropic, 11.11.2026)

Две площадки Anthropic переехали: справочный центр по приватности теперь `privacy.claude.com`,
документация API — `platform.claude.com`. Обе принадлежат Anthropic. Сторонние источники не
использовались.

| Факт | Дословно | Источник |
|---|---|---|
| Не обучает модели на данных API | «Anthropic may not train models on Customer Content from Services.» | Commercial Terms of Service, раздел B — https://www.anthropic.com/legal/commercial-terms (Effective Jun 17, 2025) |
| DPA входит в условия по ссылке | «…processed in accordance with the Anthropic Data Processing Addendum ("DPA"), which is incorporated into these Terms by reference.» | Commercial Terms, раздел C (там же) |
| DPA принимается вместе с условиями, без подписи | «When you accept Anthropic's Commercial Terms of Service, you also accept our DPA.» | https://privacy.claude.com/en/articles/7996862-how-do-i-view-and-sign-your-data-processing-addendum-dpa (16.03.2026) |
| SCC в DPA | «the SCCs Module Two (controller to processor) and/or Module Three (processor to processor)… are hereby incorporated by reference…»; к ним UK и Swiss Addendum; право и надзор — Ирландия | DPA, раздел I.1 и Schedule 3 — https://www.anthropic.com/legal/data-processing-addendum (Effective Feb 24, 2025) |
| EU-US Data Privacy Framework | **не найдено** ни в DPA, ни в политике, ни в справочном центре; передача — по SCC | — |
| Срок хранения входов и выходов API | «we automatically delete inputs and outputs on our backend within 30 days of receipt or generation, except…» | https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data (01.07.2026) |
| Исключения из 30 дней | Files API и подобное под контролем клиента; иное соглашение (zero data retention); нарушение Usage Policy; закон. Отмеченное системами безопасности: входы и выходы — до 2 лет, оценки — до 7 лет | там же |
| «7 дней» | **не найдено** ни на одной официальной странице | — |
| После окончания договора | удаление данных клиента «within thirty (30) days of the date of termination or expiration» | DPA, раздел H.1 |
| Сторона договора для клиента из ЕЭЗ | «"Anthropic" means Anthropic Ireland, Limited if Customer resides in the European Economic Area ("EEA"), Switzerland or UK…» | Commercial Terms, вводный раздел |
| Адрес | Anthropic Ireland, Limited, 6th Floor, South Bank House, Barrow Street, Dublin 4, D04 TR29, Ireland | Privacy Policy — https://www.anthropic.com/legal/privacy (Effective Sep 10, 2026) |
| Где данные | «By default, we may route customer traffic to select countries in the US, Europe, Asia and Australia…» и «Note that data is stored in the US.» | https://privacy.claude.com/en/articles/7996890-where-are-your-servers-located-do-you-host-your-models-on-eu-servers (15.06.2026) |
| Контакты | privacy@anthropic.com; DPO — dpo@anthropic.com; юридические уведомления — notices@anthropic.com | Privacy Policy; Commercial Terms |
| Представитель в ЕС | **не найден**: стороной договора в ЕЭЗ выступает сама Anthropic Ireland | — |
| Субобработчики | список на https://trust.anthropic.com/subprocessors (на него ведёт Schedule 4 DPA); даты у списка нет, последнее изменение на https://trust.anthropic.com/updates — 15.10.2026 | ниже |

**Субобработчики, относящиеся к API** (из 22 строк списка; остальные — только для потребительских
тарифов, Claude for Work или Claude for Government):
- облако: Google Cloud Platform, Amazon Web Services, Microsoft Azure — по всему миру;
- маршрутизация трафика: Cloudflare — по всему миру, ближе к клиенту;
- оплата: Stripe — США;
- вход и SSO: WorkOS — США;
- поддержка: Intercom (США), Nutun (ЮАР), Boldr (Канада);
- рассылки и аналитика: Twilio, Iterable — США;
- ошибки: Functional Software (Sentry) — США;
- защита от злоупотреблений: Sift, Arkose Labs — США; Intuition Machines (hCaptcha) — по всему миру;
- веб-поиск: Brave Search, TurboPuffer, Parallel Web Systems — США. Наш вызов поиск не использует.

**Не проверено на странице, только по нашему аккаунту:** что организация в Console заведена как
клиент из ЕЭЗ (Чехия), то есть договор заключён с Anthropic Ireland. Проверяет владелец в
настройках организации Console.

## 1. Где что меняется

| Место | Сейчас | Правка |
|---|---|---|
| `docs/privacy-dpa-links.md`, таблица DPA | Supabase, Vercel, Expo, Sentry; Anthropic нет (пункт 21 плана). Строка 10 устарела: «Vercel Pro оплачен», хотя сейчас Hobby | строка Anthropic и блок под ней (ниже); строку 10 исправить |
| `privacy.recipients.vendors.*` и `vendorRows` в `privacy-policy.tsx` | шесть поставщиков | `vendors.anthropic` в трёх языках |
| `privacy.recipients.terms` | «С Supabase, Vercel, Expo и Sentry — {{agreements}}…» | добавить фразу про Anthropic (ниже); тест `privacy-page.test.tsx:132` сверяет строку |
| `privacy.recipients.transfers` | «…основание проверено для каждого поставщика» | не меняется: для Anthropic основание — SCC в DPA (сверено 11.11) |
| новый `privacy.data.guestTexts` | о текстах гостей на странице ничего нет | абзац (ниже) в разделе данных |
| раздел 5, срок хранения | — | строка «Тексты отзывов гостей» (ниже) |

`privacy.basis.*` не трогается: новое правовое основание не заявляется. Строка «нет автоматизированных
решений с правовыми последствиями» остаётся верной.

## 2. Текст

**Строка поставщика (Поставщик | Что делает | Где):**
- ru: Anthropic (Anthropic Ireland, Limited) | разбор отзывов гостей и их сообщений во время
  проживания искусственным интеллектом, после удаления имён, контактов и кодов | Ирландия; данные
  хранятся в США
- en: Anthropic (Anthropic Ireland, Limited) | AI analysis of guest reviews and of guests' messages
  during a stay, after names, contacts and codes are removed | Ireland; data stored in the USA
- cs: Anthropic (Anthropic Ireland, Limited) | analýza recenzí hostů a jejich zpráv během pobytu umělou
  inteligencí, po odstranění jmen, kontaktů a kódů | Irsko; data uložena v USA

**Фраза к `privacy.recipients.terms`:**
- ru: «С Anthropic действует договор об обработке данных со стандартными договорными условиями ЕС: он
  входит в её коммерческие условия. На наших данных Anthropic свои модели не обучает.»
- en: «With Anthropic, a data processing agreement with the EU standard contractual clauses applies: it
  is part of its commercial terms. Anthropic does not train its models on our data.»
- cs: «Se společností Anthropic platí smlouva o zpracování údajů se standardními smluvními doložkami
  EU, která je součástí jejích obchodních podmínek. Anthropic na našich datech své modely netrénuje.»

**Абзац `privacy.data.guestTexts`:**

ru: «<b>Отзывы и сообщения гостей.</b> Отзывы гостей с площадок бронирования и сообщения, которые гости
сами пишут во время проживания, разбирает языковая модель искусственного интеллекта (Claude компании
Anthropic), чтобы находить неисправности в квартирах. Гость может упомянуть вас по имени: до того как
текст сохранится или уйдёт модели, имена гостей и сотрудников, контакты, ссылки, коды и числа от
четырёх цифр заменяются метками. Модель получает только этот текст — ни вашу учётную запись, ни ваши
рабочие данные, — и того, что вы пишете в приложении, она не читает. Сообщения компании гостям модели
не отправляются. Модель лишь отмечает возможную неисправность (тему, срочность и уверенность); что
делать, решает менеджер, а оценок отдельных сотрудников по текстам гостей система не строит. Тексты
отзывов с заменёнными именами храним не дольше 18 месяцев, текст сообщений не храним вовсе. Anthropic
удаляет полученные тексты в течение 30 дней; дольше — только если её системы безопасности отметят
текст как нарушающий правила использования или этого требует закон.»

en: «<b>Guest reviews and messages.</b> Guests' reviews from the booking platforms, and the messages
guests themselves write during their stay, are analysed by an AI language model (Anthropic's Claude) to
find faults in the apartments. A guest may mention you by name: before a text is stored or sent to the
model, the names of guests and staff, contacts, links, codes and numbers of four digits or more are
replaced by placeholders. The model gets only this text — never your account or your work data — and it
does not read anything you write in the app. The company's messages to guests are not sent to the
model. It only marks a possible fault (its theme, urgency and how sure it is); a manager decides what to
do, and the system builds no ratings of individual employees from guests' texts. We keep review texts,
with the names already replaced, for at most 18 months, and we do not keep the text of messages at all.
Anthropic deletes the texts it receives within 30 days, longer only if its safety systems flag a text as
breaking its usage policy or the law requires it.»

cs: «<b>Recenze a zprávy hostů.</b> Recenze hostů z rezervačních platforem a zprávy, které hosté sami
napíší během pobytu, analyzuje jazykový model umělé inteligence (Claude od společnosti Anthropic), aby
se našly poruchy v bytech. Host vás může zmínit jménem: než se text uloží nebo odešle modelu, jména
hostů a pracovníků, kontakty, odkazy, kódy a čísla od čtyř číslic se nahradí zástupnými značkami. Model
dostane jen tento text, nikdy váš účet ani vaše pracovní údaje, a nečte nic, co píšete v aplikaci.
Zprávy společnosti hostům se modelu neodesílají. Model jen označí možnou poruchu (téma, naléhavost a
jistotu); o dalším postupu rozhoduje manažer a systém z textů hostů nehodnotí jednotlivé pracovníky.
Texty recenzí s nahrazenými jmény uchováváme nejvýše 18 měsíců, text zpráv neuchováváme vůbec.
Anthropic přijaté texty maže do 30 dnů, déle jen tehdy, když je jeho bezpečnostní systémy označí za
porušení pravidel používání nebo když to vyžaduje zákon.»

**Строка срока хранения:** «Тексты отзывов гостей (имена заменены) — не дольше 18 месяцев; тексты
сообщений гостей не хранятся» / «Guest review texts (names replaced) — at most 18 months; texts of
guests' messages are not stored» / «Texty recenzí hostů (jména nahrazena) — nejvýše 18 měsíců; texty
zpráv hostů se neukládají».

**Строка реестра `privacy-dpa-links.md`:**

| Обработчик | Договор | Где принят | Передача в США |
|---|---|---|---|
| Anthropic Ireland, Limited (Claude API, Claude Haiku 5.5; отзывы — с 04.11, чаты — с 11.11) | DPA (Effective Feb 24, 2025) входит в Commercial Terms (Effective Jun 17, 2025) по ссылке | автоматически при принятии Commercial Terms, без подписи | SCC модули 2 и 3 в DPA, ирландское право; DPF не заявлен |

Под таблицей:
- **Что уходит:**
  - обезличенный текст отзыва;
  - у чатов только сообщения гостя за дни проживания, ещё и без `[CODE]`/`[ID]`;
  - сообщения хозяина не уходят никогда.
- **Что храним:**
  - метки (тема, срочность, уверенность);
  - тексты новых отзывов — до 18 месяцев;
  - текст сообщений — нигде.
- **Срок хранения у Anthropic:** удаление в течение 30 дней; отмеченное системами безопасности — входы и
  выходы до 2 лет, оценки до 7 лет; после окончания договора — 30 дней (DPA H.1).
- **Субобработчики:** список https://trust.anthropic.com/subprocessors, изменения —
  https://trust.anthropic.com/updates.
- **Контакты:** privacy@anthropic.com, DPO dpo@anthropic.com.

## 3. Открытые юридические вопросы (юрист не привлекался, решение владельца 06.11 и 10.11)

1. **Правовое основание** разбора отзывов и чатов не установлено. Рабочая гипотеза в документах —
   законный интерес (ст. 6(1)(f)) с тестом баланса. Текст выше основание не заявляет.
2. **Гости не уведомлены:** уведомление отложено 01.11. С включёнными чатами это весомее, чем для
   отзывов.
3. **Условия Anthropic** сверены 11.11 (раздел 0). Остаётся проверить по аккаунту: организация в
   Console заведена как клиент из ЕЭЗ.
4. **Облегчённая оценка рисков** (DPIA) систематического разбора чатов не написана.
5. **Возражение гостя:** метка «не разбирать эту бронь» (решение 13) для чатов не сделана.
6. **Сотрудники (§ 316 zákoníku práce):** имена заменяются, оценок нет. Но темы по объекту и месяцу
   можно вручную сопоставить с тем, кто убирал.
7. **Условия Airbnb и Booking** о разборе отзывов и сообщений через PMS не проверены.
8. **Мелочь:** строка 10 `privacy-dpa-links.md` и комментарий в `settings.ts` («Vercel Pro») устарели.
   Vercel Hobby по своим условиям — только для некоммерческого использования.
