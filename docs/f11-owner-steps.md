# F11 — шаги владельца: Firebase, Apple, Sentry, Expo

Короткий список к `docs/f11-plan.md` (подробности и «почему» — разделы 7 и 8
плана). Идёт параллельно с этапом 2. Отмечайте галочками; в чат присылать только
то, что помечено «сообщить» — **ключи, пароли и файлы-секреты в чат не
присылать никогда**.

**Где запускать команды.** Всё с `eas` — в **своём окне** PowerShell или Windows
Terminal, из папки `C:\Users\Roman\Desktop\Cleaning App\apps\mobile`. Через `!` в
сессии Claude команды с меню и входом не работают: `eas-cli` без терминала падает
на первом вопросе.

## Можно сейчас

### Android — Firebase и FCM

- [ ] **1.** https://console.firebase.google.com → «Add project» → имя, например
  «STR Ops» → Google Analytics можно выключить.
- [ ] **2.** В проекте — значок Android → package name ровно
  **`cz.strops.cleaner`** → Register app → скачать **`google-services.json`**.
  Шаги «Add Firebase SDK» пропустить.
- [ ] **3.** Положить файл в EAS (не в репозиторий — он публичный):
  ```
  npx eas-cli env:set --name GOOGLE_SERVICES_JSON --type file --value .\google-services.json --visibility secret --environment preview --environment production
  ```
  Файл потом хранить вне папки проекта.
- [ ] **4.** Firebase → шестерёнка → Project settings → Service accounts →
  «Generate new private key» → скачается JSON. **Это секрет.**
- [ ] **5.** Загрузить его в EAS — либо в своём окне:
  `npx eas-cli credentials -p android` → профиль `preview` → Google Service
  Account → «Manage your Google Service Account Key for Push Notifications
  (FCM V1)» → Set up → «Upload a new service account key» → путь к JSON;
  либо на сайте: expo.dev → проект `str-ops-cleaner` → Credentials → Android →
  FCM V1 service account key. После загрузки JSON удалить.
- [ ] **Сообщить:** «FCM готов» (без файлов).

### Apple

**Отложено (решение 2026-10-02):** Apple — после того, как вы проверите готовое
приложение на Android (ROADMAP, «Порядок с 2026-10-02»). Шаги 7–9, 13–15 и 17 —
тогда же; для выката F11 на Android они не нужны.

- [x] **6.** Apple Developer Program как **частное лицо** ($99 в год), Apple ID с
  двухфакторной проверкой. **Заведён** (владелец, 2026-09-30).
- [ ] **7. Осталось:** App Store Connect → Users and Access →
  Integrations → App Store Connect API → **«Request Access»**. Нажать может только
  Account Holder, то есть вы; Apple рассматривает запрос сама, поэтому лучше
  сразу. Ключ пока **не** создавать.
- [ ] **8. Сообщить:** название приложения для App Store Connect (уникальное во
  всём магазине; на экране телефона всё равно будет имя из сборки) и модели
  iPhone горничных с версией iOS (Настройки → Основные → Об этом устройстве).
  Нужна **iOS 16.4 или новее** — iPhone 8 / X и новее с обновлённой системой.
- [ ] **9. Сообщить:** кто проверяет iPhone во внутренней группе TestFlight. Этот
  человек станет пользователем App Store Connect (Users and Access → «+» → его
  почта Apple ID, роль с наименьшими правами из допустимых для внутреннего
  тестирования — Marketing или Developer, доступ только к этому приложению).
  Приглашение отправлять после первой сборки iOS (шаг 13).

### Sentry (решение 8 — да)

- [ ] **10.** https://sentry.io → регистрация, бесплатный план Developer →
  организация → проект платформы **React Native**.
- [ ] **11. Сообщить:** DSN проекта (он публичный, его можно в чат) и слаги
  организации и проекта.
- [ ] **12.** Settings → Auth Tokens → создать токен организации. **Секрет** —
  в чат не присылать; положить в EAS с видимостью `sensitive` командами из
  `docs/rollout/f11-runbook.md`, раздел 1, п.5 — **все четыре переменные Sentry
  вместе**: токен без организации и проекта роняет сборку iOS.

## Ждёт моей части

- [ ] **13. Первая сборка iOS** — в день выката, шаг 8 ранбука (после `db push`:
  сборка 1.1.0 ходит в новую схему). Профиль уже есть; в своём окне:
  `npx eas-cli build -p ios --profile testflight`. Вход Apple ID, код 2FA, выбор
  команды; на вопрос «Setup Push Notifications for your project?» — **да**
  (EAS создаст ключ APNs сам, файл `.p8` вам не нужен). Если сборка упадёт на
  `time-sensitive` — developer.apple.com → Identifiers → `cz.strops.cleaner` →
  включить «Time Sensitive Notifications» и собрать снова.
- [ ] **14. Первая отправка в TestFlight** — тоже в своём окне, с входом Apple
  ID: `npx eas-cli submit -p ios`. Она создаёт запись приложения в App Store
  Connect (ключом API это нельзя). Через 10–15 минут сборка в TestFlight.
- [ ] **15.** После записи — ключ App Store Connect API (если Apple одобрила шаг
  7): `npx eas-cli credentials -p ios` → «App Store Connect: Manage your API Key»
  → создать. Дальше сборки и отправки идут без 2FA.
- [ ] **16. Токен Expo для отправки push** — после деплоя функции `send-push`
  (скажу когда): expo.dev → аккаунт `namorenames-team` → Settings → робот
  (Robot users) с наименьшей ролью → токен → секрет функции в Supabase. Только
  **после** этого — переключатель «Enhanced security for push notifications» в
  Settings → Access tokens аккаунта. Раньше не включать: с ним Expo отвергает
  push без токена.
- [ ] **17. Календарь** — после первой iOS-сборки для горничных: напоминание на
  75-й день («пересобрать iOS до 90-го»), и годовые — продление Apple Developer и
  профиля распространения.

## При переходе на Pro (Supabase)

Не срочно: когда будете переходить с бесплатного тарифа. Видео до этого идёт в
бесплатных пределах (до 2 минут, до 45 МБ). Подробности —
`docs/rollout/f11-runbook.md`, раздел 6.

- [ ] Supabase → организация → **Billing** → тариф **Pro**.
- [ ] Проект → **Storage → Settings → «Global file size limit»** → **150 МБ**.
- [ ] Панель → «Настройки → Процесс → **Видео**» → заготовка **«Pro»**. Появится
  с этапом «Видео». Можно сказать мне — поменяю сам.
- [ ] **Spend cap** (организация → Billing → Cost Control) — трогать, только если
  видео в хранилище станет больше 100 ГБ. Выключить, иначе загрузки встанут до
  конца месяца.
- [ ] **PostgREST 14.18 или новее** — лечит редкие 401 «JWT issued at future»,
  которые в панели сейчас обходит повтор запроса. На бесплатном тарифе не
  обновляем (решение 2026-10-02): там кнопки «Upgrade project» нет, обновление —
  пауза и восстановление проекта, то есть простой всего: вебхуков, кронов,
  панели и приложения. После перехода на Pro:
  1. Проект → Settings → **Infrastructure** — есть ли кнопка **«Upgrade
     project»**.
  2. **Есть** — сказать мне до обновления. Я снимаю свежий снимок «до» (снимок
     02.10 к тому времени устареет), вы обновляете, я сверяю: версия PostgREST,
     функции, кроны, права, триггеры, политики. Обновление — тоже простой:
     вечером, когда горничные не работают.
  3. **Нет** — запрос в поддержку Supabase: обновить PostgREST проекта до 14.18
     или новее.
- Ни сборки, ни обновления по воздуху не нужно.

## Чего не делать

- Не коммитить `google-services.json`, JSON сервисного аккаунта, `.p8`, токены.
- Не включать «Enhanced security» у Expo до шага 16.
- Не создавать ключ APNs вручную, если EAS создаст его на шаге 13 (у аккаунта
  лимит — два ключа).
