-- Отзыв привилегий у роли anon в схеме public.
--
-- Обнаружено после первого db push: на хостинге Supabase новые таблицы
-- схемы public автоматически получают гранты для anon через default
-- privileges. Локальный стек так не делает, поэтому дымовой тест этого
-- не показывал. Проверка снаружи: POST /rest/v1/properties с одним лишь
-- publishable-ключом возвращал 42501 "violates row-level security policy",
-- то есть запрос доходил до RLS — привилегия у anon была.
--
-- Сейчас данные держит один слой: ни одна политика не написана для anon,
-- поэтому он не видит строк. Но это единственная преграда. Политика,
-- случайно созданная без `to authenticated` (или с `to public`), мгновенно
-- открыла бы таблицу всему интернету — publishable-ключ по замыслу лежит
-- в клиентском бандле и публичен.
--
-- Аноним в приложении не участвует вовсе: вход только по приглашению,
-- анонимные сессии выключены. Поэтому отзываем всё и правим default
-- privileges, чтобы будущие таблицы не получали грантов заново.

revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

-- USAGE на саму схему оставляем: без неё PostgREST отдаёт анониму
-- невнятную ошибку вместо чистого 401, а публичные RPC (если появятся)
-- всё равно потребуют явного отдельного гранта.
