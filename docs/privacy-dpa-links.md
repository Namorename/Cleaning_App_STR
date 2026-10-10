# Политика: договоры с поставщиками и откуда взяты значения

Ветка `privacy-settings-1010`, 2026-10-10. Значения страницы `/privacy` лежат в
`apps/web/src/app/privacy/settings.ts`. Два утверждения там оставлены `null`:
`processingAgreementsSigned` и `transferBasisChecked`. Их ставит владелец, когда
сам примет договоры ниже. Пока они `null`, страница показывает их жирной
заглушкой «вписать: подтвердить».

## Договоры об обработке данных (DPA)

| Поставщик | Где DPA | Как принимается | Перенос в США |
| --- | --- | --- | --- |
| Supabase | https://supabase.com/legal/customer-resources/data-processing-addendum | Встроен в условия (Terms §7(b), https://supabase.com/terms) — подпись не нужна; подписанную копию можно запросить отдельно | SCC (модули 2 и 3) внутри DPA |
| Vercel | https://vercel.com/legal/dpa | Встроен в условия по ссылке (Terms §10.1, https://vercel.com/legal/terms) | SCC 2021/914 (модули 1–3) и UK Addendum |
| Expo (650 Industries) | Отдельной страницы DPA нет; условия обработки — Terms §3.2, https://expo.dev/terms | Встроены в условия; отдельный DPA — через https://expo.dev/contact (в Trust Center: «MSA and DPA terms are available», https://expo.dev/trust) | SCC (модуль 2) в Terms §3.2; Data Privacy Framework (https://expo.dev/privacy) |
| Sentry | https://sentry.io/legal/dpa/ | **Не автоматически.** Organization Settings → **Legal & Compliance** → принять (только роль Owner или Billing); инструкция: https://docs.sentry.io/security-legal-pii/security/terms/ | SCC (модули 2 и 3) как запасное основание к Data Privacy Framework |

**Sentry — срочно.** Условия Sentry (Terms §4.4, https://sentry.io/terms/): пока
DPA не принят, клиент не должен отправлять в сервис персональные данные. Отчёты
о сбоях могут содержать id пользователя.

## Откуда взяты значения

- **vercelRegion — США (Вашингтон, iad1).** Функции прод-деплоя работают в `iad1`.
  Это видно в `npx vercel inspect <деплой> --cwd apps/web` и в заголовке `x-vercel-id`:
  `fra1::iad1::…`, где fra1 — точка входа, iad1 — функция. `iad1` — регион по
  умолчанию у новых проектов: https://vercel.com/docs/functions/configuring-functions/region.
  Сменить на Франкфурт: проект → Settings → Functions → Function Regions → `fra1`.
  Это решение владельца; после смены поменять и значение.
- **sentryRegion — ЕС (Франкфурт).** Хост приёма в DSN оканчивается на `.de.sentry.io`,
  то есть это регион ЕС. Его данные хранятся во Франкфурте:
  https://docs.sentry.io/organization/data-storage-location/ и
  https://docs.sentry.io/security-legal-pii/security/ip-ranges/.
- **serverLogRetention — не дольше 7 дней.**
  - Supabase хранит журналы API и базы 1 день на Free и 7 дней на Pro:
    https://supabase.com/pricing.
  - Vercel хранит журналы выполнения 1 час на Hobby и 1 день на Pro:
    https://vercel.com/docs/logs/runtime.
  - Семь дней верны на обоих тарифах.
  - Отдельно: журнал аудита входа Supabase может писаться в таблицу базы
    `auth.audit_log_entries` без срока хранения. Это настройка Authentication →
    Audit Logs: https://supabase.com/docs/guides/auth/audit-logs.

## На что обратить внимание

- **Vercel Hobby — только для личного или некоммерческого использования**
  (Terms §4, https://vercel.com/legal/terms). Для панели компании нужен Pro.
- `effectiveDate` 2026-10-12, `automaticDeletionDate` 2027-03-31,
  `signInBlockDate` 2026-11-30, `accountRetentionMonths` 6 и `exportFormat` CSV —
  значения владельца.
- «Кто удаляет» — оператор, по письму. Фраза раздела 5 теперь говорит «по вашему
  письму на адрес из раздела 1» на трёх языках.
