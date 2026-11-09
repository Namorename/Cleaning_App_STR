# Вход в MCP-сервер по OAuth — выкат

Устройство — `docs/mcp-oauth.md`. Ветка `mcp-oauth-1109`. Каждый облачный шаг — только словом
владельца. Окно 03:00–04:40 UTC не трогать. Чтение истории отзывов идёт по расписанию: шаги его не
касаются.

## Что едет

| Часть | Что | Как проверено |
|---|---|---|
| Миграция | `20261109120000_mcp_oauth.sql`, sha256 `aac1a1deb791a59c29dbf547ea9582ce5d67e1c886398a001a9d2c18601b14db` | все SQL-наборы (55, 2 672 проверки), стенд, откат в транзакции |
| Edge Functions | `oauth` (новая), `mcp` и `api` (изменён `api/handler.ts`, который бандлят обе; `mcp` ещё и `_shared/mcp-oauth.ts`) | `test:fn` 629, `deno check` трёх точек входа, стенд SDK 12/12 |
| Панель | `main` fast-forward, Vercel | tsc, eslint, vitest, `next build`, живой `next start` |
| Телефон | не едет: код телефона не менялся, в общих переводах только ключи панели и `/developers/mcp` | jest переводов 60 |

Секретов и настроек Supabase не добавляется. Нужные функциям `API_KEY_PEPPER`, `SUPABASE_URL` и
секретный ключ уже заданы проекту. Адрес панели (`https://woom-bnb.vercel.app`) зашит в
`_shared/mcp-oauth.ts`.

## Порядок

1. **Миграция** — застава и push одной командой.
2. **Пробы** — `postpush_mcp_oauth_1109.sql`.
3. **Функции** — `oauth`, `mcp`, `api`.
4. **Проверки функций** без ключа.
5. **`main`** — fast-forward, панель на Vercel.
6. **Проверка владельцем** — коннектор в claude.ai.

Между шагами ничего не ломается:

- **После миграции:** старые функции зовут `api_gate` двумя аргументами и получают прежний ответ
  (`p_channel` по умолчанию — «только ключи»). Старая панель читает список ключей как раньше:
  подключений ещё нет, у всех строк есть префикс.
- **После функций и до `main`:** MCP отвечает 401 со ссылкой на метаданные, но метаданные сервера
  входа на панели появятся только с `main`. Вход по OAuth заработает с шагом 5; ключи работают всё
  время.

### 1. Застава и push

```bash
HEAD_WANT=20261106125500
LIST_WANT="20261109120000_mcp_oauth.sql"
SHA_WANT=aac1a1deb791a59c29dbf547ea9582ce5d67e1c886398a001a9d2c18601b14db
[ "$(sha256sum supabase/migrations/20261109120000_mcp_oauth.sql | cut -d' ' -f1)" = "$SHA_WANT" ] &&
[ "$(node scripts/cloud-read.mjs docs/rollout/remote_head.sql |
     node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(String(JSON.parse(s)[0].head))}catch{}})")" = "$HEAD_WANT" ] &&
[ "$(npx supabase db push --linked --skip-vault --dry-run --output-format json |
     node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(JSON.parse(s).migrations.join(' '))}catch{}})")" = "$LIST_WANT" ] &&
npx supabase db push --linked --skip-vault
```

### 2. Пробы

`node scripts/cloud-read.mjs docs/rollout/postpush_mcp_oauth_1109.sql`

| Поле | До (09.11, 22:40 UTC) | После |
|---|---|---|
| `head` | `20261106125500` | `20261109120000` |
| `tables` | пусто | `oauth_clients`, `oauth_codes`, `oauth_tokens` |
| `grants` | пусто | пусто |
| `exec` | `api_gate(text,text) service_role`, `api_authorize -`, `api_key_public_json -` | `api_gate(text,text,text) service_role`; `oauth_authorize` — `authenticated`; `oauth_client` — `authenticated,service_role`; `oauth_issue_tokens`, `oauth_refresh_tokens`, `oauth_register_client` — `service_role`; остальное `-` |
| `columns` | 15 колонок | плюс `kind`, `oauth_client_id`, `oauth_client_name`, `oauth_redirect_uri` |
| `kinds` | `{"key":1}` | `{"key":1}` |
| `keys` | 0 | 0 |

### 3. Функции

Из дерева ветки, по одной:

```bash
npx supabase functions deploy oauth
npx supabase functions deploy mcp
npx supabase functions deploy api
```

`verify_jwt = false` берётся из `config.toml` (`[functions.oauth]` добавлен).

### 4. Проверки функций, без ключа

- `POST …/functions/v1/mcp` без заголовка `Authorization` → 401, `WWW-Authenticate` содержит
  `resource_metadata="…/functions/v1/mcp/.well-known/oauth-protected-resource"`.
- `GET …/functions/v1/mcp/.well-known/oauth-protected-resource` → 200; `resource` — адрес сервера,
  `authorization_servers` — `["https://woom-bnb.vercel.app"]`.
- `POST …/functions/v1/oauth/token` с `grant_type=refresh_token&refresh_token=woomrt_` и 43 символами
  `A` → 400 `invalid_grant`: запрос дошёл до базы (`oauth_refresh_tokens`), права и сигнатура на месте.
- Ключ владельца через MCP по-прежнему видит 14 инструментов («Только чтение»). Это проверка
  владельца: ключ у него.

### 5. `main`

Fast-forward `main` до коммита ветки, затем Vercel Ready. Проверки:

- `https://woom-bnb.vercel.app/.well-known/oauth-authorization-server` → 200, JSON с
  `"issuer":"https://woom-bnb.vercel.app"` и `token_endpoint` на функции `oauth`;
- `/oauth/authorize` без входа → 307 на `/login?next=…`;
- `/developers/mcp` → 200.
- `resource` из метаданных сервера (шаг 4) совпадает с адресом сервера на `/developers/mcp`: панель
  строит его из `NEXT_PUBLIC_SUPABASE_URL`, функция — из `SUPABASE_URL`. Расхождение дало бы
  `invalid_target` на каждом обмене кода.

### 6. Проверка владельцем

1. В claude.ai: Customize → Connectors → Add custom connector, адрес
   `https://<проект>.supabase.co/functions/v1/mcp`, Connect.
2. На странице woom войти админом, выбрать «Только чтение» и нажать «Разрешить».
3. Спросить Claude: «Какие уборки запланированы на завтра?»
4. В Настройки → API должно появиться «OAuth · Claude». Там же проверить отзыв.

## Откат — в обратном порядке

1. **Панель:** `git revert` коммита ветки в `main`.
2. **Функции:**
   - `npx supabase functions delete oauth`;
   - `mcp` и `api` передеплоить из `f10f203` (дерево `main` до правки).
3. **База:** `docs/one-off-writes/mcp-oauth-rollback.sql` через
   `npx supabase db query --linked -f …`, затем
   `npx supabase migration repair --status reverted 20261109120000 --linked`. Только словом
   владельца и не в 03:00–04:40 UTC.
   - Отрепетировано: объектов OAuth не остаётся, `api_keys` и `api_gate` прежние, набор `api_v1.sql`
     из `main` зелёный.
   - Откат удаляет подключения OAuth с их журналом. Строки их запросов в `api_request_log`
     остаются, без ключа.
