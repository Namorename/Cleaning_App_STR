# Сборка 1.2.0: Android и iPhone — чек-лист владельца

**Обновлён 2026-10-09 вечером** (решения владельца 09.10: живое тестирование в понедельник 12.10,
iPhone в приоритете, а если Apple не успеет — запуск на Android). Здесь только то, что владелец
делает сам, точными командами для PowerShell и по порядку. Входы в Expo и Apple, сборки и отправки
выполняются только в окне владельца: без терминала `eas-cli` не проходит меню и вход Apple.

## 0. Что готово

- **Коммит сборки — `dab5237`** (ветка `phone-1-2-0`). Нативная часть заморожена: `expo-symbols`
  остаётся, потому что его импортирует сам `expo-router` (иконки системных вкладок на Android);
  удалять его небезопасно. Всё, что сделано после `dab5237`, — только JavaScript, оно приходит
  обновлением по воздуху на 1.2.0.
- **Папка сборки — `.claude\worktrees\build-1-2-0`**: отдельное дерево ровно на `dab5237`, `npm ci`
  уже сделан. Собирать только оттуда. EAS берёт рабочую папку как есть, вместе с незакоммиченным
  (`requireCommit` в `eas.json` не задан), поэтому папка должна быть чистой и на этом коммите.
- Версия 1.2.0, `runtimeVersion` = версия приложения: обновления по воздуху для 1.1.0 сюда не
  попадают, и наоборот.
- Переменные EAS (сверено 09.10, значения не выводились): `EXPO_PUBLIC_SUPABASE_URL`,
  `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `EXPO_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`
  (видимость plain), `SENTRY_AUTH_TOKEN` (secret), `GOOGLE_SERVICES_JSON` (secret, файл) — все семь в
  окружениях `preview` и `production`; это одни и те же переменные, значит одна и та же база.
- Профили (`apps/mobile/eas.json`):

  | Профиль | Для кого | Окружение EAS | Канал обновлений | Что получится |
  |---|---|---|---|---|
  | `preview` | телефон владельца (Android) | `preview` | `preview` | APK, внутренняя раздача |
  | `field` | горничные, Android | `production` | `field` | APK, внутренняя раздача |
  | `field-ios` | горничные и владелец, iPhone | `production` | `field` | сборка для TestFlight |
  | `testflight` | запасной iPhone на канале `preview` | `preview` | `preview` | сборка для TestFlight |

- iOS: `bundleIdentifier` `cz.strops.cleaner`, номер сборки растёт сам; образ
  `macos-tahoe-26.5-xcode-26.6` закреплён (SDK 57 без сцен UIScene, Xcode 27 не годится);
  `usesNonExemptEncryption: false`; право `time-sensitive` для срочных push; тексты разрешений
  камеры, микрофона и фото на ru, en, cs. Нужна iOS 16.4 или новее.
- Apple Developer Program оплачен (Active), продление до 2027-10-05.

## 1. Сборка Android 1.2.0 для себя (профиль `preview`)

```powershell
cd "$env:USERPROFILE\Desktop\Cleaning App\.claude\worktrees\build-1-2-0\apps\mobile"
git log -1 --oneline        # dab5237 fix(mobile): the owner stamp waits for the wipe; …
git status --short          # пусто; если нет — не собирать, написать мне
npx eas-cli whoami          # namorenames-team (или ваш логин с доступом к нему); иначе npx eas-cli login
npx eas-cli build -p android --profile preview
```

- `npm ci` в этой папке **не нужен**: он уже сделан 09.10. Если папку создавали заново —
  `npm ci` из `...\worktrees\build-1-2-0` (корень дерева, не `apps\mobile`), около минуты.
- Если EAS спросит **«Generate a new Android Keystore?» — ответ «нет»**, и сборку остановить. Ключ,
  которым подписаны 1.0.0 и 1.1.0, лежит в EAS; новый ключ даст APK, который не встанет поверх
  1.1.0 (телефон потребует удалить старое приложение, а с ним вход и очередь действий). Проверка:
  `npx eas-cli credentials -p android` → профиль `preview` → там должен быть ключ (keystore) от 02.10
  или раньше.
- Сборка идёт 15–40 минут (на бесплатном плане бывает очередь). В конце — ссылка и QR-код.

**Установка поверх 1.1.0.** На телефоне открыть ссылку сборки (или QR) → скачать APK → «Установить»
(Android попросит разрешить установку из браузера) → «Обновить». **1.1.0 не удалять**: та же подпись
и тот же номер версии (`versionCode` 1, как у 1.0.0 и 1.1.0), поэтому Android ставит обновление, а
вход и очередь сохраняются. Версию видно в настройках Android: Приложения → woom → «Версия 1.2.0».

Проверки на телефоне — раздел 5. Видео: сначала 10 секунд, потом 90 (свой клиент докачки проверен
только тестами, это первая живая проверка).

## 2. Сборка Android для горничных (профиль `field`) — после проверки `preview`

```powershell
cd "$env:USERPROFILE\Desktop\Cleaning App\.claude\worktrees\build-1-2-0\apps\mobile"
git log -1 --oneline        # снова dab5237
npx eas-cli build -p android --profile field
```

Тот же коммит, канал `field`. Ссылку на APK раздать горничным; у кого стоит 1.1.0 — ставить
поверх, не удаляя. Учётки и привязки к объектам — до раздачи, в панели «Команда» (владелец сам).

**Обновления по воздуху.** Сначала на `preview` → проверка на своём телефоне → то же обновление на
`field` (команды — раздел 6). На `field` ничего не отправляется раньше, чем проверено на `preview`.

## 3. Первая сборка iOS (профиль `field-ios`)

```powershell
cd "$env:USERPROFILE\Desktop\Cleaning App\.claude\worktrees\build-1-2-0\apps\mobile"
git log -1 --oneline        # dab5237
git status --short          # пусто
npx eas-cli build -p ios --profile field-ios
```

Ответы на вопросы:
- вход Apple ID, код 2FA, выбор команды (Individual);
- «Generate a new Apple Distribution Certificate?» — **да**;
- «Generate a new Apple Provisioning Profile?» — **да**;
- «Setup Push Notifications for your project?» — **да**: EAS сам создаст ключ APNs и положит его в
  свои учётные данные; файл `.p8` вам не нужен, руками ключ не создавать.

Если сборка упадёт на `time-sensitive`: developer.apple.com → Certificates, Identifiers & Profiles →
Identifiers → `cz.strops.cleaner` → включить **Time Sensitive Notifications** → собрать снова. В логе
сборки должен быть Xcode 26.x. Сборка идёт 20–40 минут.

iPhone владельца на `field-ios` получает канал `field`, как горничные: обновление по воздуху
сначала проверяется на Android (`preview`, тот же JavaScript), потом идёт на `field` обеим
платформам. Отдельный iPhone на `preview` — профиль `testflight`, вторая сборка; пока не нужна.

### 3.1 Отправка в App Store Connect и TestFlight

```powershell
npx eas-cli submit -p ios --profile field-ios --latest
```

Первая отправка создаёт запись приложения в App Store Connect: название (уникальное во всём
магазине; «woom», скорее всего, занято — например «woom team»; под иконкой всё равно будет «woom»
из сборки — решает владелец), основной язык, SKU (любое, например `strops-cleaner`). Через 10–15
минут сборка появится в App Store Connect → TestFlight. Вопросов об экспорте шифрования не будет.

### 3.2 Ключ App Store Connect API (по желанию, после записи приложения)

```powershell
npx eas-cli credentials -p ios
```

→ «App Store Connect: Manage your API Key» → создать. Дальше сборки и отправки идут без 2FA. Нужен
одобренный запрос доступа к API (Users and Access → Integrations → App Store Connect API →
«Request Access», нажимает только Account Holder).

## 4. TestFlight

### 4.1 Внутренний (без рецензии Apple) — на понедельник

App Store Connect → TestFlight → Internal Testing → «+» группа → добавить себя → сборка. На iPhone:
приложение TestFlight из App Store → «woom» → установить.

Внутренние тестировщики — только пользователи App Store Connect вашей команды (до 100 человек).
Если внешний TestFlight не успеет к понедельнику, горничных можно сделать пользователями: Users
and Access → «+» → их Apple ID, роль с наименьшими правами (Marketing), доступ только к этому
приложению → добавить во внутреннюю группу. Рецензии нет, но каждая горничная получает вход в App
Store Connect вашей команды с этой ролью — решает владелец.

### 4.2 Внешний (горничным по ссылке, рецензия Apple ~сутки)

App Store Connect → TestFlight → External Testing → «+» группа → сборка → **Test Information**:

- **Beta App Description** — приложение для сотрудников компании краткосрочной аренды (уборки,
  задания, расходники); вход только по учётке от менеджера, регистрации нет.
- **Feedback Email** и **контакт** (имя, телефон, почта) — вводит владелец; в репозиторий не пишутся.
- **Sign-in required → да, демо-учётка.** С 10.10 в облаке есть демо-объект «Demo Apartment»
  (`docs/launch-reset.md`, «Демо-объект для Apple»). Владелец заводит демо-горничную, привязывает
  её к нему и ставит 2–3 уборки. Учётку настоящей компании рецензенту не давать.
- **Privacy Policy URL** — `https://woom-bnb.vercel.app/privacy?lang=en` (в проде с 10.10).

Готовые английские тексты (Beta App Description, What to Test, заметки рецензенту), пошаговый путь
«внутренний → внешний» с названиями кнопок и смена названия «woom (deaac4)» —
`docs/testflight-texts.md`.

«Submit for Review» → обычно меньше суток. Сборка TestFlight живёт **90 дней** — на 75-й день
пересобрать.

## 5. Что проверить на телефоне (Android сейчас, iPhone после сборки)

- Два холодных запуска; вход; выход. Установка поверх 1.1.0 сохранила вход.
- Иконка, название «woom» при русском и чешском языке системы; заставка в светлой и тёмной теме.
- Разрешения камеры, микрофона и фото — текст на языке системы; отказ — понятный экран, а не вылет.
- Шаг с фото. **Шаг с видео: сначала 10 секунд, потом 90**: запись, просмотр, «Переснять»,
  отправка по мобильной сети, сворачивание во время загрузки и продолжение после возврата.
  Как получить шаг видео — `docs/launch-phone-plan.md`, «Живая проверка».
- Push: разрешение, приход при закрытом приложении, нажатие из закрытого (холодный старт) и из фона
  открывает нужный экран; срочный push пробивает «Фокус» (iPhone).
- Тёмная тема, самый крупный шрифт системы, TalkBack / VoiceOver на главных экранах.
- Без связи: действие встаёт в очередь и уходит после появления сети.
- Роли: горничная, техник, главный техник — каждая видит свои вкладки.

## 6. Обновления по воздуху на 1.2.0 (только по слову владельца)

Перед каждым: `npx supabase migration list --linked` (схема, которую читает код, должна быть в
облаке), и обновление делается из ветки, а не из `main`, пока `phone-1-2-0` не влита.

```powershell
cd "$env:USERPROFILE\Desktop\Cleaning App\.claude\worktrees\redesign-native-screens\apps\mobile"
npx eas-cli update --branch preview --environment preview --message "<что везёт>"
# проверка на своём телефоне, затем то же самое обновление горничным, байт в байт:
npx eas-cli update:list --branch preview --limit 1 --json --non-interactive   # id группы
npx eas-cli update:republish --group <id группы> --destination-branch field --message "<что везёт>"
```

Канал и ветка `field` появляются сами при первой сборке `field` или `field-ios` (сейчас в EAS есть
только канал `preview`); `update:republish` на `field` возможен только после неё. После
`eas update` — выгрузка source maps в Sentry (раздел 6.1). Первое обновление на 1.2.0 везёт и повтор
запроса после 401 «JWT issued at future» (ветка `mobile-401-retry`, слово владельца 03.10).

### 6.1 Source maps в Sentry (PowerShell владельца)

Без source maps ошибки из обновлений приходят в Sentry без строк кода. Выгружать нужно ровно те
бандлы, что ушли в обновление: папку `dist`, которую `eas update` собрал для этой группы. Следующий
`eas update` её перезаписывает.

| Группа | Коммит | Папка с бандлами |
| --- | --- | --- |
| `0567f6d0` (10.10, 18:24 UTC) | `d5a3fb6` | `$env:USERPROFILE\dev-tools\str-ops\day-1010\dist-0567f6d0` (копия сохранена) |
| `885973f0` (10.10, 17:34 UTC) | `b5e55f6` | не сохранена — только пересборка, ниже |
| `ccd211b5` (10.10, 16:49 UTC) | `a0fb97c` | не сохранена — только пересборка, ниже |

**После каждого следующего обновления** сразу сохранить его `dist`. `<группа>` — первые 8 знаков
«Update group ID» из вывода `eas update`.

```powershell
cd "$env:USERPROFILE\Desktop\Cleaning App\.claude\worktrees\redesign-native-screens\apps\mobile"
Copy-Item -Recurse dist "$env:USERPROFILE\dev-tools\str-ops\dist-<группа>"
```

**Выгрузка.** Нужен токен организации Sentry, а не токен чтения из `~/.str-ops`: Sentry →
Settings → Developer Settings → Organization Tokens → создать (права `org:ci`). Значения не
записываются ни в файлы, ни в репозиторий. `SENTRY_ORG` и `SENTRY_PROJECT` — те же, что в
переменных EAS окружения `preview` (EAS → Environment variables). Регион ЕС — `https://de.sentry.io/`.

```powershell
cd "$env:USERPROFILE\Desktop\Cleaning App\.claude\worktrees\redesign-native-screens\apps\mobile"
$env:SENTRY_ORG = Read-Host "SENTRY_ORG"
$env:SENTRY_PROJECT = Read-Host "SENTRY_PROJECT"
$env:SENTRY_URL = "https://de.sentry.io/"
$token = Read-Host "SENTRY_AUTH_TOKEN" -AsSecureString
$env:SENTRY_AUTH_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($token))

npx sentry-expo-upload-sourcemaps "$env:USERPROFILE\dev-tools\str-ops\day-1010\dist-0567f6d0"
# следующие группы — та же команда со своей папкой:
# npx sentry-expo-upload-sourcemaps "$env:USERPROFILE\dev-tools\str-ops\dist-<группа>"

Remove-Item Env:SENTRY_AUTH_TOKEN   # токен не остаётся в окне
```

В выводе должно быть «⬆️ Uploading android bundle and sourcemap…» и то же для ios.

**Пересборка для `885973f0` и `ccd211b5` (по желанию).** Эти обновления уже заменены `0567f6d0`:
телефоны переходят на него при следующем запуске, и ошибки старых групп скоро перестанут приходить.
Если они всё же нужны, бандл пересобирается из того же коммита с теми же переменными. Перед
выгрузкой его сверяют с опубликованным: выгружать только при совпадении.

```powershell
cd "$env:USERPROFILE\Desktop\Cleaning App"
git worktree add --detach .claude\worktrees\sourcemaps-b5e55f6 b5e55f6   # для ccd211b5 — a0fb97c
cd .claude\worktrees\sourcemaps-b5e55f6
npm ci
cd apps\mobile
npx eas-cli env:exec preview "npx expo export --output-dir dist-885973f0 --experimental-bundle --dump-sourcemap --dump-assetmap --platform=all --clear"

# сверка: MD5 бандла Android должен совпасть с "key" у "launchAsset" в манифесте группы
(Get-FileHash -Algorithm MD5 (Get-ChildItem dist-885973f0\_expo\static\js\android\*.hbc).FullName).Hash
npx eas-cli update:view 885973f0-664d-4b3d-be70-00a7c1bfe5d7 --json   # manifestPermalink → открыть, найти "launchAsset" → "key"
# совпало — выгрузить, как выше, указав папку dist-885973f0
```

Полные id групп: `ccd211b5-6864-4df4-ac4f-eb69e819d507`, `885973f0-664d-4b3d-be70-00a7c1bfe5d7`,
`0567f6d0-4d66-4fed-9d1f-f045b6e78074`. Для `0567f6d0` сверка уже сделана: MD5 бандла Android в
копии равен `key` в манифесте группы.

## 7. Календарь

- 75-й день после каждой сборки iOS для горничных — пересобрать (TestFlight живёт 90 дней).
- **До 2027-10-05** — включить автопродление Apple Developer Program (≈2 799 CZK в год).
- До апреля 2027 — SDK 58 со сценами UIScene и образом Xcode 27.
