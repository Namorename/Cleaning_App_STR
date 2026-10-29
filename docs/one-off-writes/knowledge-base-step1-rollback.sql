-- Rollback of 20261017100000_knowledge_base (docs/knowledge-base-step1.md, «Откат»).
-- A WRITE to the cloud: only on the owner's word, never in 03:00–04:40 UTC.
--
-- Order (the doc says it in full):
--   1. the panel first: if the knowledge base is already in main, revert the
--      merge and let Vercel deploy — a panel without the tables shows an
--      error on /knowledge;
--   2. the articles, if any are worth keeping: copy the four tables out
--      (the doc gives the read that does it) — this file DROPS them;
--   3. this file, one statement:
--        npx supabase db query --linked -f docs/one-off-writes/knowledge-base-step1-rollback.sql
--   4. the history: npx supabase migration repair --status reverted 20261017100000 --linked
--   5. the probe: node scripts/cloud-read.mjs docs/rollout/postpush_knowledge_base.sql —
--      every label empty or false, the head back where it was.
--
-- Nothing else of the schema points at these objects: no existing table,
-- function or policy reads them, and the phone does not read them yet.
do $$
begin
  perform set_config('lock_timeout', '3s', true);

  drop function public.restore_kb_revision(uuid, integer, timestamptz);
  drop function public.set_kb_article_status(uuid, public.kb_status);
  drop function public.save_kb_article(uuid, public.app_language, text, text, jsonb,
                                       public.kb_scope, bigint[], timestamptz);
  drop function public.kb_assert_publishable(text, public.kb_scope, integer);
  drop function public.kb_write_translations(uuid, uuid, jsonb);
  drop function public.kb_checked_translations(public.app_language, jsonb);
  drop function public.kb_article_for_writer(uuid);

  -- The tables take their triggers and policies with them.
  drop table public.kb_article_revisions;
  drop table public.kb_article_translations;
  drop table public.kb_article_targets;
  drop table public.kb_articles;

  drop function public.kb_staff_article_ids();
  drop function public.kb_reader_property_ids();
  drop function public.kb_translations_version();
  drop function public.kb_articles_snapshot();
  drop function public.kb_articles_version();
  drop function public.kb_snapshot(uuid);

  drop type public.kb_scope;
  drop type public.kb_status;
end $$;
