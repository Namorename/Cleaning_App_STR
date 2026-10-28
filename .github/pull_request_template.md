## Что и зачем

<!-- Коротко: что меняется для горничной, техника, менеджера или владельца. -->

## Паритет API (CLAUDE.md, «Паритет API»; docs/api-v1.md §10)

- [ ] Новых публичных функций, таблиц и представлений нет — или каждая записана в
      `packages/shared/src/api/coverage.json` (exposed / planned / internal с причиной)
- [ ] Новая возможность продукта выставлена в API: функция `api_v1_*` в миграции, маршрут в
      `supabase/functions/api/routes.ts`, операция в `packages/shared/src/api/openapi.v1.yaml`
- [ ] Новое право — в `registry.json` с уровнем чувствительности, в блоке `api-scopes` миграции,
      с переводом en/cs/ru (`panel.settings.api.scopes.*`)
- [ ] `npm run api:docs` прогнан, `npm run api:lint` чист
- [ ] Контракт: `npm run test:fn` (contract.test.ts), `npm run test:web` (api-parity.test.ts);
      для записи или нового чтения — `scripts/api-stand-server.ts contract` на стенде
- [ ] API не нужен — запись `internal` с причиной, а не тишина
- [ ] Ничего из запретного списка не выставлено; в ответах нет гостей, почт и телефонов
      сотрудников, кодов дверей, свободного текста заметок

## Проверки

<!-- Числа прогонов: SQL-наборы, deno, vitest, tsc, eslint; что не прогонялось и почему. -->

## Выкат

<!-- Миграция (db push с --dry-run), функции, панель, телефон — что, в каком порядке, чьим словом. -->
