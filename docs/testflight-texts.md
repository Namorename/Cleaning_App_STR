# TestFlight: тексты для App Store Connect и путь к внешнему тестированию

Подготовлено 2026-10-10 для сборки iOS 1.2.0. Личных данных здесь нет. Почту для отзывов, контакт для
рецензента (имя, телефон, почта) и логин с паролем демо-учётки владелец вводит прямо в App Store
Connect; в репозиторий они не пишутся.

## 1. Тексты (вставлять по-английски)

App Store Connect → приложение → **TestFlight** → в боковой панели **Additional → Test Information** →
язык **English (U.S.)**.

### Beta App Description

```text
woom is the internal operations app of a short-term rental company. Cleaners, technicians and
the head technician see the cleanings, inspections and repairs assigned to them, work through
checklist steps with photos and short videos, report issues found on site as tasks, request
supplies and chat with the office about a job. Accounts are created by the company's manager;
there is no public sign-up. The app speaks English, Czech and Russian.
```

### What to Test

Окно **What to Test** открывается само, когда сборку добавляют во внешнюю группу.

```text
Sign in with the demo account from the review information. "My cleanings" lists the demo
cleanings at "Demo Apartment", one for each of the next days. Open today's cleaning, tap
"Start cleaning" and go through its steps: tick the checklist, take the photos after cleaning,
record a short video, read the instructions, write a comment and confirm. Tap "Finish
cleaning" and confirm in the dialog. Below the list, open "Done in the last 30 days" and open
the finished cleaning. From a cleaning, try "Create a task" and "Chat". In Settings, switch the
language and open "Privacy policy". A cleaning planned for a later day can be accepted but
started only on its day.
```

### Beta App Review Information → Notes (Review Notes)

```text
woom is used only by the employees of one company; their accounts are issued by the company's
manager in the web panel, so there is no sign-up screen, and the employer deletes an account on
request by e-mail (see the privacy policy). The demo account is a cleaner linked to a single demo
listing ("Demo Apartment", Demo Street 1, Prague) with one demo cleaning for each of the next
days and no real guests, bookings or addresses.

Permissions: the camera and microphone are used only to take photos and record videos of the work
in checklist steps and tasks; the photo library only to attach photos and videos the user picks;
notifications tell an employee about new or changed work and chat messages.

Privacy policy: https://woom-bnb.vercel.app/privacy?lang=en
```

Остальные поля:

- **Feedback Email** — почта владельца для отзывов (на неё же отвечают тестировщики).
- **Marketing URL** — можно оставить пустым.
- **Privacy Policy URL** — `https://woom-bnb.vercel.app/privacy?lang=en` (страница в проде, отвечает 200).
- **Beta App Review Information** — First Name, Last Name, Phone (в формате `+420…`), Email.
- **Sign-in required** — включить; **User Name** и **Password** — демо-горничной. Учётка не должна
  истекать, пока идёт рецензия.

**Демо-данные: что должно быть до отправки** (проверено чтением облака 2026-10-10):

- Есть: «Demo Apartment», активная демо-горничная, привязанная только к нему.
- **Не так:** её три уборки стоят на 20, 22 и 25 октября.
  - Горничная видит работу только на 7 дней вперёд: даже свои уборки дальше этого срока ей не
    показываются. До 13.10 рецензент увидит пустой список.
  - Начать уборку можно только в её день, не раньше времени начала окна.
- Нужно: по уборке **на каждый день с 11 по 18 октября**, окно с 00:00, назначены на
  демо-горничную. Рецензия идёт от одного до нескольких дней, и в любой из них у рецензента будет
  «сегодняшняя» уборка.
- Прошедшие незавершённые уборки ночью закрываются сами — это нормально.
- Шаги уборки берутся из шаблона компании: чек-лист, фото после, видео, указания, комментарий,
  подтверждение. Отдельного чек-листа у демо-объекта нет — это нормально.

**Какую сборку отправлять:** сборку 2 из ветки `ios-build-1-2-0` (`6e181a1`). Сборка 1 (`0505011`)
слушает канал `field`, получает обновления только оттуда, и в ней нет кнопки галереи для видео,
ссылки на политику и вопросов «Удалить» и «Снять с работы».

## 2. Путь: внутренний TestFlight → внешний

Нужна роль Account Holder, Admin или App Manager. Справка Apple:
https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers

1. **Внутренний (рецензии нет).** TestFlight → **Internal Testing** → «+» → имя группы → **Create** →
   добавить себя → в группе **Builds** → «+» → сборка 1.2.0. На iPhone: приложение **TestFlight** →
   «woom» → **Install**. Проверить вход, уборку и видео.
2. **Информация для теста** — раздел 1 выше: **Additional → Test Information**. Заполнить, **Save**.
3. **Внешняя группа.** В боковой панели «+» рядом с **External Testing** → имя (например
   «Cleaners») → **Create**.
4. **Сборка в группу.** Открыть группу → **Add Builds** → платформа iOS, версия 1.2.0 → выбрать
   сборку → **Add**.
5. **What to Test** — откроется окно: вставить текст из раздела 1. Отметить **Automatically notify
   testers**, если сразу после одобрения нужны письма.
6. **Submit Review** — сборка уходит на Beta App Review. Первая сборка версии проверяется
   полностью, обычно меньше суток. Отказ с причиной — в **General → App Review**.
7. **После одобрения** — тестировщики:
   - **по почте**: «+» рядом с **Testers** → **Add New Testers** → имя и почта;
   - **по ссылке**: **Create Public Link** → **Open to Anyone** → по желанию **Tester Limit** → **Set
     Limit** → **Confirm**; ссылку отправить горничным.
   - Ссылку потом меняют через **Manage**.
8. **Срок.** Сборка TestFlight живёт **90 дней**. На 75-й день — новая сборка (раздел 7 чек-листа
   `docs/ios-launch-checklist.md`).

## 3. Название «woom (deaac4)» → свободное

Название в App Store Connect одно для всех платформ:
- меняется в **General → App Information → Name**;
- длина от 2 до 30 знаков;
- его можно менять, пока приложение не отправлено на App Review (TestFlight не считается), потом —
  только с новой версией;
- справка: https://developer.apple.com/help/app-store-connect/reference/app-information/app-information.

Имя должно быть свободно в каждой локализации. «woom» уже занято, поэтому App Store Connect добавил
«(deaac4)». Варианты, свободность которых проверит само поле Name при сохранении:

- `woom — STR Ops`
- `woom ops`
- `woom staff`
- `woom: cleanings & tasks`

Заняли ваш товарный знак — заявка Apple: https://www.apple.com/legal/internet-services/itunes/appnamenotices/.

На главном экране iPhone подпись под иконкой берётся из сборки (`CFBundleDisplayName`). Это «woom»
из `app.json` (`expo.name`), и название в App Store Connect его не меняет. В списке приложения
TestFlight, по всей видимости, показывается имя из App Store Connect (официально это не описано).
