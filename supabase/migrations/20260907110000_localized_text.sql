-- Text a member of staff reads, in the language she reads.
--
-- Names a manager types — checklist modules and their items, and later the
-- sections of an inventory — are data, not interface: no translation file can
-- carry them, because they are written after the app ships. Stored as one
-- string they are stuck in whatever language the manager happened to use, and
-- a Czech cleaner reads Russian.
--
-- The shape, from here on, is a pair of columns:
--
--   x        the text as the manager wrote it, in the company's own language
--   x_i18n   {"en": "…", "cs": "…"} — the same text in other languages
--
-- Reading it: the translation for the reader's language, and the plain column
-- when there is none. The fallback is the point — a company that never
-- translates anything keeps working exactly as it does today, and a half
-- translated checklist shows the translated half.
--
-- Where the translations come from is F10's problem: the editor will offer a
-- field per language. This migration only fixes the shape, so that the tables
-- F7 creates are born with it rather than migrated into it later.

alter table public.hosts
  add column default_language public.app_language not null default 'ru';

comment on column public.hosts.default_language is
  'The language the plain text columns are written in. What a reader sees when there is no translation for hers.';

/**
 * Is this a well-formed bag of translations?
 *
 * An object whose keys are language codes the app has files for and whose
 * values are non-empty. Unknown codes are refused rather than ignored: a typo
 * in a language code would otherwise be stored forever and shown to nobody.
 *
 * stable, not immutable — it reads the enum — so it cannot sit in a CHECK.
 * It does not need to: these columns are only ever written through functions
 * that call it, and a CHECK on the shape alone (an object) guards the rest.
 */
create or replace function public.is_localized_text(p_value jsonb)
returns boolean
language sql
stable
parallel safe
set search_path = ''
as $$
  select jsonb_typeof(p_value) = 'object'
     and not exists (
       select 1
       from jsonb_each_text(p_value) as entry(code, value)
       where not (entry.code = any (enum_range(null::public.app_language)::text[]))
          or btrim(entry.value) = ''
     )
$$;

revoke all on function public.is_localized_text(jsonb) from public, anon;
grant execute on function public.is_localized_text(jsonb) to authenticated, service_role;
