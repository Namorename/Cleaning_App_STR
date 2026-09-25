# Ultrareview окна 3

Облачный ultrareview (`/ultrareview`, бесплатный запуск 2 из 3) ветки `window3-properties` против `main`:
38 файлов, +3798 / −146, голова ветки `1254ee8`. Результаты получены 25.09.2026 в 02:33.
Сессия ревью: https://claude.ai/code/session_01F7XB43NTDBGQ5u6gCCatkM

Находки сохранены целиком, как пришли. Многоточия (…) внутри текста — обрезка самого ultrareview,
полнее текста нет. Точный текст с экранированием — в JSON в конце файла.

Итого: 4 находки — 2 `normal`, 2 `nit`; CRITICAL/HIGH нет.

| # | Файл | Строки | Важность |
| --- | --- | --- | --- |
| 1 | `scripts/cloud-read.mjs` | 54–71 | `normal` |
| 2 | `scripts/hostaway-get.mjs` | 60–68 | `normal` |
| 3 | `apps/web/src/features/apartments/use-apartments.ts` | 79–85 | `nit` |
| 4 | `scripts/hostaway-issue-token.mjs` | 27–40 | `nit` |

Примечание вечерней сессии: `scripts/cloud-read.mjs`, `scripts/hostaway-get.mjs` и
`scripts/hostaway-issue-token.mjs` правятся только со словом владельца (CLAUDE.md, «Чтение облака…»),
их sha256 закреплены в `.claude/hooks/script-pins.json`; правка скриптов и пинов стоит в `ask`.

## 1. `scripts/cloud-read.mjs`, строки 54–71 — `normal`

**Комментарий к PR:**

> REFUSED regex guard in cloud-read.mjs, which the comment calls the only thing stopping PUBLIC-callable side-effect C functions (cron.schedule, net.*, lo_*, dblink) on the 'read-only' cloud query endpoint, is bypassed by quoting identifiers or by SET search_path

**Обоснование и проверка:**

The comment above REFUSED (lines 44-53) states the read-only DB role/transaction does NOT block cron.schedule/unschedule, net.worker_restart/wake, or the large-object functions because they are PUBLIC-executable C functions; refuseSideEffects()'s regexes (e.g. /\bcron\s*\.\s*(schedule|...)\s*\(/i, /\bnet\s*\.\s*\w+\s*\(/i, /\blo_\w+\s*\(/i, /\bdblink\w*\s*\(/i) are the actual and only boundary for these effects, not defense-in-depth. All four patterns assume the call is written as a bare, unquoted, schema-qualified identifier immediately followed by '('. A query string of `SET search_path = cron, public; SELECT schedule('x','* * * * *','select 1')` never contains the literal substring 'cron.schedule', so it passes refuseSideEffects() untouched (the 'set search_path' text is not matched by the transaction-mode regex either, which only checks 'session characteristics'/'transaction'), then reaches the Management API's read-only endpoint, which per the comment executes 'several statements' in one call and still permits PUBLIC to run cron.schedule (unqualified after the…

**Verification:** normal. scripts/cloud-read.mjs is a new file (167 lines added this PR) whose comment (lines 44-53) states the read-only role/transaction does NOT stop the PUBLIC-executable C functions cron.schedule/unschedule, net.worker_restart/wake and the large-object functions, and that `refuseSideEffects()` "Those are refused here before the query leaves the machine" — i.e. the REFUSED regexes are the…

## 2. `scripts/hostaway-get.mjs`, строки 60–68 — `normal`

**Комментарий к PR:**

> parseArgs()'s traversal guard only rejects a literal '..' substring in the API path, so a percent-encoded dot segment (%2e%2e) is passed through untouched and is then decoded by the WHATWG URL parser used by fetch(), letting the request escape the intended /v1 API root

**Обоснование и проверка:**

parseArgs() (scripts/hostaway-get.mjs:66) rejects a path only when it has a scheme, starts with '/', or `path.includes('..')`; a path like `%2e%2e/accessTokens` contains none of those and is accepted. get() then builds the request URL as a plain template string, `${baseUrl()}/${options.path}` (line 88), and hands it to the built-in fetch(), which parses it with the WHATWG URL algorithm; per the URL spec a 'double-dot path segment' includes the percent-encoded forms ('%2e%2e', '.%2e', '%2e.') and is collapsed exactly like a literal '..', so the parsed request path becomes `/accessTokens` instead of `/v1/%2e%2e/accessTokens` — i.e. the call escapes the '/v1' prefix the comment says is enforced ('the path is relative to /v1... no climbing out of /v1'), reaching whatever sits at the Hostaway API root under the same stored bearer token, with no code path here to stop it because the check is a literal-substring match rather than a decode-then-normalize comparison. Fix: normalize the path (percent-decode and resolve dot-segments, or construct the URL via `new URL(path, base)` and verify the…

**Verification:** normal (security-relevant input-validation guard, newly introduced in this PR, that fails its stated purpose). scripts/hostaway-get.mjs:66 rejects traversal only via `path.includes('..')`; a path such as `%2e%2e/accessTokens` has no scheme, does not start with `/`, and contains no literal `..`, so parseArgs() accepts it. get() (line 88) then interpolates it into… | nit (security-relevant,…

## 3. `apps/web/src/features/apartments/use-apartments.ts`, строки 79–85 — `nit`

**Комментарий к PR:**

> useSaveInfo only invalidates the query cache in onSuccess, but savePropertyInfo (api.ts) now performs two independent writes (properties.update then property_internal_notes upsert/delete); if the first succeeds and the second throws, the mutation rejects, onSuccess never runs, and the already-committed parent_id/cleaner_notes change is never reflected in any cached data.

**Обоснование и проверка:**

A manager edits both the parent listing and the internal note in the Info tab and submits. savePropertyInfo (apps/web/src/features/apartments/api.ts:117-143) first updates the properties row (parent_id, cleaner_notes) which succeeds and commits server-side, then calls saveInternalNote, which fails (e.g. RLS denial, network blip, or the notes-not-empty check constraint tripped by a race). The thrown error rejects the whole mutation promise, so useSaveInfo's onSuccess (use-apartments.ts:84, and the same pattern at useSetStatus:63 and useSyncListings:70) is skipped and useInvalidateEverywhere() is never called. That helper invalidates apartmentKeys.all, taskKeys.all and teamKeys.all (use-apartments.ts:49-56) — a broad cache surface. Every other screen reading the property from the query cache (the registry list, other open property cards, task feeds that embed the parent listing name) keeps showing the OLD parent_id/cleaner_notes even though the server row was actually already updated, while the Info tab shows a save error implying nothing was saved. This is a new failure mode: before this…

**Verification:** nit. The claim's mechanism is real: savePropertyInfo (api.ts:117-133) is now two independent writes — properties.update (122-131) then saveInternalNote (132; defined 136-147). If the first commits and the second throws (RLS denial, network, not-empty constraint), the mutation rejects. useSaveInfo (use-apartments.ts:82-85) invalidates only in onSuccess, which never runs on rejection, so cached…

## 4. `scripts/hostaway-issue-token.mjs`, строки 27–40 — `nit`

**Комментарий к PR:**

> Duplicated baseUrl()/tokenFile() helpers copy-pasted verbatim between scripts/hostaway-get.mjs and scripts/hostaway-issue-token.mjs

**Обоснование и проверка:**

Both files define the identical baseUrl() (loopback-only override check) and tokenFile() functions; a future change to the loopback-allowlist regex or the default token path (e.g. tightening the override check) has to be made in both files, and it is easy to update one and forget the other, silently reopening the bypass in whichever file is missed. Fix: move both helpers into a small shared module (e.g. scripts/lib/hostaway-env.mjs) imported by both scripts.

**Verification:** nit — the duplication is real. scripts/hostaway-issue-token.mjs:27-40 and scripts/hostaway-get.mjs:33-46 both define byte-identical baseUrl() (with the loopback-only regex /^http:\/\/(127\.0\.0\.1|localhost):\d+$/) and tokenFile() (default join(homedir(), '.str-ops', 'hostaway-token.json')), plus the shared LIVE_BASE_URL const. A future tightening of the loopback check or token path would…

## Исходный JSON

```json
[
  {
    "file_path": "scripts/cloud-read.mjs",
    "severity": "normal",
    "pr_comment": "REFUSED regex guard in cloud-read.mjs, which the comment calls the only thing stopping PUBLIC-callable side-effect C functions (cron.schedule, net.*, lo_*, dblink) on the 'read-only' cloud query endpoint, is bypassed by quoting identifiers or by SET search_path",
    "reasoning": "The comment above REFUSED (lines 44-53) states the read-only DB role/transaction does NOT block cron.schedule/unschedule, net.worker_restart/wake, or the large-object functions because they are PUBLIC-executable C functions; refuseSideEffects()'s regexes (e.g. /\\bcron\\s*\\.\\s*(schedule|...)\\s*\\(/i, /\\bnet\\s*\\.\\s*\\w+\\s*\\(/i, /\\blo_\\w+\\s*\\(/i, /\\bdblink\\w*\\s*\\(/i) are the actual and only boundary for these effects, not defense-in-depth. All four patterns assume the call is written as a bare, unquoted, schema-qualified identifier immediately followed by '('. A query string of `SET search_path = cron, public; SELECT schedule('x','* * * * *','select 1')` never contains the literal substring 'cron.schedule', so it passes refuseSideEffects() untouched (the 'set search_path' text is not matched by the transaction-mode regex either, which only checks 'session characteristics'/'transaction'), then reaches the Management API's read-only endpoint, which per the comment executes 'several statements' in one call and still permits PUBLIC to run cron.schedule (unqualified after the…\n\n**Verification:** normal. scripts/cloud-read.mjs is a new file (167 lines added this PR) whose comment (lines 44-53) states the read-only role/transaction does NOT stop the PUBLIC-executable C functions cron.schedule/unschedule, net.worker_restart/wake and the large-object functions, and that `refuseSideEffects()` \"Those are refused here before the query leaves the machine\" — i.e. the REFUSED regexes are the…",
    "start_line": 54,
    "end_line": 71
  },
  {
    "file_path": "scripts/hostaway-get.mjs",
    "severity": "normal",
    "pr_comment": "parseArgs()'s traversal guard only rejects a literal '..' substring in the API path, so a percent-encoded dot segment (%2e%2e) is passed through untouched and is then decoded by the WHATWG URL parser used by fetch(), letting the request escape the intended /v1 API root",
    "reasoning": "parseArgs() (scripts/hostaway-get.mjs:66) rejects a path only when it has a scheme, starts with '/', or `path.includes('..')`; a path like `%2e%2e/accessTokens` contains none of those and is accepted. get() then builds the request URL as a plain template string, `${baseUrl()}/${options.path}` (line 88), and hands it to the built-in fetch(), which parses it with the WHATWG URL algorithm; per the URL spec a 'double-dot path segment' includes the percent-encoded forms ('%2e%2e', '.%2e', '%2e.') and is collapsed exactly like a literal '..', so the parsed request path becomes `/accessTokens` instead of `/v1/%2e%2e/accessTokens` — i.e. the call escapes the '/v1' prefix the comment says is enforced ('the path is relative to /v1... no climbing out of /v1'), reaching whatever sits at the Hostaway API root under the same stored bearer token, with no code path here to stop it because the check is a literal-substring match rather than a decode-then-normalize comparison. Fix: normalize the path (percent-decode and resolve dot-segments, or construct the URL via `new URL(path, base)` and verify the…\n\n**Verification:** normal (security-relevant input-validation guard, newly introduced in this PR, that fails its stated purpose). scripts/hostaway-get.mjs:66 rejects traversal only via `path.includes('..')`; a path such as `%2e%2e/accessTokens` has no scheme, does not start with `/`, and contains no literal `..`, so parseArgs() accepts it. get() (line 88) then interpolates it into… | nit (security-relevant,…",
    "start_line": 60,
    "end_line": 68
  },
  {
    "file_path": "apps/web/src/features/apartments/use-apartments.ts",
    "severity": "nit",
    "pr_comment": "useSaveInfo only invalidates the query cache in onSuccess, but savePropertyInfo (api.ts) now performs two independent writes (properties.update then property_internal_notes upsert/delete); if the first succeeds and the second throws, the mutation rejects, onSuccess never runs, and the already-committed parent_id/cleaner_notes change is never reflected in any cached data.",
    "reasoning": "A manager edits both the parent listing and the internal note in the Info tab and submits. savePropertyInfo (apps/web/src/features/apartments/api.ts:117-143) first updates the properties row (parent_id, cleaner_notes) which succeeds and commits server-side, then calls saveInternalNote, which fails (e.g. RLS denial, network blip, or the notes-not-empty check constraint tripped by a race). The thrown error rejects the whole mutation promise, so useSaveInfo's onSuccess (use-apartments.ts:84, and the same pattern at useSetStatus:63 and useSyncListings:70) is skipped and useInvalidateEverywhere() is never called. That helper invalidates apartmentKeys.all, taskKeys.all and teamKeys.all (use-apartments.ts:49-56) — a broad cache surface. Every other screen reading the property from the query cache (the registry list, other open property cards, task feeds that embed the parent listing name) keeps showing the OLD parent_id/cleaner_notes even though the server row was actually already updated, while the Info tab shows a save error implying nothing was saved. This is a new failure mode: before this…\n\n**Verification:** nit. The claim's mechanism is real: savePropertyInfo (api.ts:117-133) is now two independent writes — properties.update (122-131) then saveInternalNote (132; defined 136-147). If the first commits and the second throws (RLS denial, network, not-empty constraint), the mutation rejects. useSaveInfo (use-apartments.ts:82-85) invalidates only in onSuccess, which never runs on rejection, so cached…",
    "start_line": 79,
    "end_line": 85
  },
  {
    "file_path": "scripts/hostaway-issue-token.mjs",
    "severity": "nit",
    "pr_comment": "Duplicated baseUrl()/tokenFile() helpers copy-pasted verbatim between scripts/hostaway-get.mjs and scripts/hostaway-issue-token.mjs",
    "reasoning": "Both files define the identical baseUrl() (loopback-only override check) and tokenFile() functions; a future change to the loopback-allowlist regex or the default token path (e.g. tightening the override check) has to be made in both files, and it is easy to update one and forget the other, silently reopening the bypass in whichever file is missed. Fix: move both helpers into a small shared module (e.g. scripts/lib/hostaway-env.mjs) imported by both scripts.\n\n**Verification:** nit — the duplication is real. scripts/hostaway-issue-token.mjs:27-40 and scripts/hostaway-get.mjs:33-46 both define byte-identical baseUrl() (with the loopback-only regex /^http:\\/\\/(127\\.0\\.0\\.1|localhost):\\d+$/) and tokenFile() (default join(homedir(), '.str-ops', 'hostaway-token.json')), plus the shared LIVE_BASE_URL const. A future tightening of the loopback check or token path would…",
    "start_line": 27,
    "end_line": 40
  }
]
```
