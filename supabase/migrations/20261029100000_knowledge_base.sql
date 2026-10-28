-- The knowledge base, step 1: articles, the places they belong to, their
-- translations and their versions (docs/knowledge-base-step1.md; the plan is
-- docs/knowledge-base-plan.md, §2 and §5.7, narrowed by the owner's decisions
-- of 2026-10-16 and 2026-10-17).
--
-- Text only. No pictures, video, files or PDFs (they will join task_media as
-- a new owner), no search, no access codes (F27), no hints in a cleaning, and
-- nothing for the phone yet: these rules are what step 2 will read through.
--
-- - kb_articles: one row an article. The original is in its author's
--   language (language, title, body); the status is draft, published or
--   archived; scope says where it shows — the whole company, one building (a
--   listing with rooms or parts under it), or places chosen one by one.
-- - kb_article_targets: the places of a building's or a chosen-places
--   article. An article on a house shows in its rooms and parts; a cleaner
--   linked to the house reads the articles of its rooms.
-- - kb_article_translations: the other languages, each optional. A table, not
--   the x / x_i18n pair of the names a manager types (CLAUDE.md): a text runs
--   to 20 000 characters and is versioned together with its translations.
-- - kb_article_revisions: the text as it was after each saved change — the
--   original and its translations together — numbered 1, 2, 3… A version is
--   brought back as a new one (restore_kb_revision); history is not rewritten.
--
-- Who reads (decision 5):
-- - a manager and the head technician: every article of their company,
--   drafts and the archive included, with its places, translations and
--   versions;
-- - a cleaner: the published articles of the whole company, of the places
--   she is linked to (property_cleaners), and of the places of the work she
--   holds now on a stand-in shift (a task assigned to her and not yet done,
--   cancelled or expired, on a place not archived; 2026-10-17) — each with
--   the house above a room and the rooms under a house, as cleans_property
--   reads a link;
-- - a technician: the same, for the places of the work he holds now, and the
--   house above them;
-- - a person switched off, another company, anon: nothing.
-- The rule is two definer sets, kb_reader_property_ids() and
-- kb_staff_article_ids(), behind `= any (array(...))` — built once a
-- statement, as staff_property_ids() is (20260924140000), and the only way
-- for the policies of the targets and of the articles to ask each other
-- without recursing. Every policy keeps host_id = current_host_id(). The
-- office's policy is named to sort after the field staff's, so a manager's
-- read stops at the cheap branch (permissive policies are OR'ed in
-- descending order of name, 20260924150000).
--
-- Who writes: the managers and the head technician (decision 1), only through
-- save_kb_article, set_kb_article_status and restore_kb_revision. The tables
-- are read-only to every client: revoke all, then select. The id of a new
-- article is minted by the panel, so a save retried after a lost answer finds
-- its own article instead of writing a second one. A save from a screen older
-- than the article is refused when the screen says which article it showed
-- (p_expected_updated_at: every write moves updated_at — the text, a
-- translation, a place, the status; null asks nothing), unless what is stored
-- is exactly what the same writer sends — her own save, retried. An id of
-- another company's article is "not found", never overwritten.
--
-- Versions are the triggers' work, not the RPCs': whoever writes the text or
-- a translation — an RPC, a service script — makes a version. One write is
-- one version however many rows it touches (two statements sent in one
-- simple-protocol message, as `db query -f` sends a file, count as one): the
-- stamp of a write — kept as an md5, so readers learn nothing of the
-- cluster's transaction counter — is the
-- transaction and the statement the client sent, and the article keeps the
-- stamp of the write that made its current version. A change of places or of
-- status is no new version of the text.
--
-- Nothing is written to existing tables; no lock on a busy one is taken
-- beyond the foreign keys' brief SHARE ROW EXCLUSIVE on hosts, profiles and
-- properties.

set local lock_timeout = '3s';

create type public.kb_status as enum ('draft', 'published', 'archived');
create type public.kb_scope as enum ('company', 'building', 'properties');

-- ---------- the tables ----------

create table public.kb_articles (
  id            uuid primary key,
  host_id       uuid not null references public.hosts(id) on delete restrict,
  status        public.kb_status not null default 'draft',
  scope         public.kb_scope not null,
  language      public.app_language not null,
  title         text not null check (btrim(title) <> '' and char_length(title) <= 200),
  body          text not null default '' check (char_length(body) <= 20000),
  -- The version the text is at, and which write made it (the triggers' own).
  rev           integer not null default 1 check (rev > 0),
  rev_stamp     text,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles(id) on delete set null,
  updated_at    timestamptz not null default now(),
  published_at  timestamptz,
  constraint kb_articles_published_when check (status <> 'published' or published_at is not null),
  -- What the other three tables point at: the article and its company.
  constraint kb_articles_host_id_id_key unique (host_id, id)
);

comment on table public.kb_articles is
  'Knowledge base articles (20261029100000): the original text in its author''s language, the status and where it shows. Written through save_kb_article, set_kb_article_status and restore_kb_revision only.';
comment on column public.kb_articles.rev_stamp is
  'Internal: the write (transaction and statement) that made the current version; one write is one version.';

create trigger kb_articles_touch
  before update on public.kb_articles
  for each row execute function public.touch_updated_at();

create table public.kb_article_targets (
  article_id   uuid not null,
  property_id  bigint not null,
  host_id      uuid not null,
  primary key (article_id, property_id),
  -- The only keys: one path to each table for PostgREST, and the article,
  -- the place and the row all of one company.
  foreign key (host_id, article_id) references public.kb_articles(host_id, id) on delete cascade,
  foreign key (host_id, property_id) references public.properties(host_id, id) on delete cascade
);

create index kb_article_targets_property_idx on public.kb_article_targets (property_id);

comment on table public.kb_article_targets is
  'The places of an article whose scope is a building or chosen places. An article on a house shows in its rooms and parts (20261029100000).';

create table public.kb_article_translations (
  article_id  uuid not null,
  language    public.app_language not null,
  host_id     uuid not null,
  title       text not null check (btrim(title) <> '' and char_length(title) <= 200),
  body        text not null default '' check (char_length(body) <= 20000),
  updated_at  timestamptz not null default now(),
  primary key (article_id, language),
  foreign key (host_id, article_id) references public.kb_articles(host_id, id) on delete cascade
);

comment on table public.kb_article_translations is
  'An article in a language other than its original''s; each optional (20261029100000).';

create table public.kb_article_revisions (
  article_id    uuid not null,
  rev           integer not null check (rev > 0),
  host_id       uuid not null,
  language      public.app_language not null,
  title         text not null,
  body          text not null,
  -- {"cs": {"title": "…", "body": "…"}, …}: the translations as they were.
  translations  jsonb not null default '{}'::jsonb,
  edited_by     uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  primary key (article_id, rev),
  foreign key (host_id, article_id) references public.kb_articles(host_id, id) on delete cascade
);

comment on table public.kb_article_revisions is
  'The text of an article after each saved change, with its translations; kept by triggers, read by the office (20261029100000).';

-- ---------- versions ----------

-- The version as it stands now: written once a write, rewritten while the
-- same write goes on touching the article or its translations.
create function public.kb_snapshot(p_article uuid)
returns void
language sql
set search_path = ''
as $$
  insert into public.kb_article_revisions as r
    (article_id, rev, host_id, language, title, body, translations, edited_by)
  select a.id, a.rev, a.host_id, a.language, a.title, a.body,
         coalesce((select jsonb_object_agg(t.language::text,
                                           jsonb_build_object('title', t.title, 'body', t.body))
                   from public.kb_article_translations t
                   where t.article_id = a.id), '{}'::jsonb),
         (select auth.uid())
  from public.kb_articles a
  where a.id = p_article
  on conflict (article_id, rev) do update
    set language = excluded.language,
        title = excluded.title,
        body = excluded.body,
        translations = excluded.translations,
        edited_by = excluded.edited_by;
$$;

comment on function public.kb_snapshot(uuid) is
  'Writes the article''s current version into kb_article_revisions (20261029100000). Called by the triggers only.';

-- Which version a write of the article is. The text changed, or a
-- translation asked for a version by stamping the article: the next number,
-- once a write. Anything else keeps the number; rev and rev_stamp are never
-- the writer's to set.
create function public.kb_articles_version()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_stamp constant text := md5(pg_current_xact_id()::text || '/' || statement_timestamp()::text);
begin
  if tg_op = 'INSERT' then
    new.rev := 1;
    new.rev_stamp := v_stamp;
  elsif old.rev_stamp is not distinct from v_stamp then
    new.rev := old.rev;
    new.rev_stamp := old.rev_stamp;
  elsif (new.language, new.title, new.body) is distinct from (old.language, old.title, old.body)
        or new.rev_stamp is not distinct from v_stamp then
    new.rev := old.rev + 1;
    new.rev_stamp := v_stamp;
  else
    new.rev := old.rev;
    new.rev_stamp := old.rev_stamp;
  end if;
  return new;
end;
$$;

-- After the row is written: the version of this write, as it now stands.
create function public.kb_articles_snapshot()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.rev_stamp is not distinct from
       md5(pg_current_xact_id()::text || '/' || statement_timestamp()::text) then
    perform public.kb_snapshot(new.id);
  end if;
  return null;
end;
$$;

-- A translation written or removed: the article's version of this write —
-- the next one, asked for by the stamp, or the one this write already made.
create function public.kb_translations_version()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_stamp constant text := md5(pg_current_xact_id()::text || '/' || statement_timestamp()::text);
  v_article uuid := case when tg_op = 'DELETE' then old.article_id else new.article_id end;
begin
  update public.kb_articles a
  set rev_stamp = v_stamp
  where a.id = v_article
    and a.rev_stamp is distinct from v_stamp;
  if not found then
    perform public.kb_snapshot(v_article);
  end if;
  return null;
end;
$$;

create trigger kb_articles_version
  before insert or update on public.kb_articles
  for each row execute function public.kb_articles_version();

create trigger kb_articles_snapshot
  after insert or update on public.kb_articles
  for each row execute function public.kb_articles_snapshot();

create trigger kb_translations_version
  after insert or update or delete on public.kb_article_translations
  for each row execute function public.kb_translations_version();

-- ---------- who reads ----------

-- The places whose articles a cleaner or a technician reads. Hers: the places
-- she is linked to, and those of the work she holds now — a stand-in shift —
-- unless the place of that work is itself archived; each with the house above
-- it and, for a house, the rooms under it, as a link has always opened them
-- (whether that house or those rooms are archived is not asked, as for a
-- link). His: the places of the work he holds now, archived or not, with the
-- house above them. Work held now is a task of any kind assigned to that
-- person and not yet done, cancelled or expired, however far ahead it is
-- planned: the open statuses of the phone's list of her own work
-- (fetchMyTasks) less 'unassigned', which nobody holds; the phone's horizon
-- does not narrow it. Empty for anybody else and for a person switched off,
-- work still hers included. No company filter inside: a target is of its
-- article's company by its keys, and the policies keep host_id =
-- current_host_id().
create function public.kb_reader_property_ids()
returns setof bigint
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select p.id, p.role
    from public.profiles p
    where p.id = (select auth.uid()) and p.is_active
  ),
  held as (
    select t.property_id as id, me.role
    from public.tasks t
    join me on me.id = t.assignee_id
    where t.status in ('assigned', 'accepted', 'in_progress', 'paused', 'blocked')
  ),
  hers as (
    select pc.property_id as id
    from public.property_cleaners pc
    join me on me.id = pc.cleaner_id
    where me.role = 'cleaner'
    union
    select held.id
    from held
    join public.properties p on p.id = held.id
    where held.role = 'cleaner'
      and p.status <> 'archived'
  ),
  tie as (
    select hers.id from hers
    union
    select held.id from held where held.role = 'tech'
  )
  select tie.id from tie
  union
  select p.parent_id
  from public.properties p
  join tie on tie.id = p.id
  where p.parent_id is not null
  union
  select r.id
  from public.properties r
  join hers on hers.id = r.parent_id
  where r.hostaway_unit_id is not null;
$$;

comment on function public.kb_reader_property_ids() is
  'Places whose knowledge base articles a cleaner (by link, or by the work she holds now on a place not archived) or a technician (by the work he holds now) reads, with the house above, and the rooms under a house of hers (decision 5 of 2026-10-16 and decision 1 of 2026-10-17, 20261029100000).';

-- The published articles a cleaner or a technician reads: the company's, and
-- those of her places.
create function public.kb_staff_article_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with places as materialized (
    select public.kb_reader_property_ids() as id
  )
  select a.id
  from public.kb_articles a
  where a.host_id = (select public.current_host_id())
    and a.status = 'published'
    and (a.scope = 'company'
         or exists (select 1
                    from public.kb_article_targets t
                    join places on places.id = t.property_id
                    where t.article_id = a.id));
$$;

comment on function public.kb_staff_article_ids() is
  'Published articles a cleaner or a technician reads: the whole company''s and those of kb_reader_property_ids() (20261029100000).';

-- ---------- rights ----------

revoke all on public.kb_articles, public.kb_article_targets,
              public.kb_article_translations, public.kb_article_revisions
  from public, anon, authenticated;
grant select on public.kb_articles, public.kb_article_targets,
                public.kb_article_translations, public.kb_article_revisions
  to authenticated;
grant select, insert, update, delete on public.kb_articles, public.kb_article_targets,
                                        public.kb_article_translations, public.kb_article_revisions
  to service_role;

alter table public.kb_articles enable row level security;
alter table public.kb_article_targets enable row level security;
alter table public.kb_article_translations enable row level security;
alter table public.kb_article_revisions enable row level security;

create policy "office reads every article"
  on public.kb_articles for select
  to authenticated
  using (((select public.is_manager()) or (select public.is_head_tech()))
         and host_id = (select public.current_host_id()));

create policy "field staff read the published articles of their places"
  on public.kb_articles for select
  to authenticated
  using (host_id = (select public.current_host_id())
         and id = any (array(select public.kb_staff_article_ids())));

create policy "office reads every place of an article"
  on public.kb_article_targets for select
  to authenticated
  using (((select public.is_manager()) or (select public.is_head_tech()))
         and host_id = (select public.current_host_id()));

-- Her own places of an article she reads, not the others it names.
create policy "field staff read their places of the articles they read"
  on public.kb_article_targets for select
  to authenticated
  using (host_id = (select public.current_host_id())
         and article_id = any (array(select public.kb_staff_article_ids()))
         and property_id = any (array(select public.kb_reader_property_ids())));

create policy "office reads every translation"
  on public.kb_article_translations for select
  to authenticated
  using (((select public.is_manager()) or (select public.is_head_tech()))
         and host_id = (select public.current_host_id()));

create policy "field staff read the translations of the articles they read"
  on public.kb_article_translations for select
  to authenticated
  using (host_id = (select public.current_host_id())
         and article_id = any (array(select public.kb_staff_article_ids())));

create policy "office reads every version"
  on public.kb_article_revisions for select
  to authenticated
  using (((select public.is_manager()) or (select public.is_head_tech()))
         and host_id = (select public.current_host_id()));

-- ---------- writes ----------

-- The article in the company of the caller, locked; "not found" for any
-- other, another company's included.
create function public.kb_article_for_writer(p_id uuid)
returns public.kb_articles
language plpgsql
set search_path = ''
as $$
declare
  v_article public.kb_articles;
begin
  if not (public.is_manager() or public.is_head_tech()) then
    raise exception 'Only a manager or the head technician may write an article'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOrHeadTechOnly';
  end if;

  select a.* into v_article
  from public.kb_articles a
  where a.id = p_id and a.host_id = public.current_host_id()
  for update;
  if not found then
    raise exception 'Article % not found', p_id
      using errcode = 'check_violation', hint = 'serverErrors.kbArticleNotFound';
  end if;

  return v_article;
end;
$$;

comment on function public.kb_article_for_writer(uuid) is
  'The caller''s company''s article, locked for update, for a manager or the head technician; refuses anybody else (20261029100000). Called by the write RPCs only.';

-- The text and its translations a version is made of, checked as a save
-- checks them.
create function public.kb_checked_translations(p_language public.app_language, p_translations jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_clean jsonb := '{}'::jsonb;
  v_language text;
  v_entry jsonb;
  v_title text;
  v_body text;
begin
  if jsonb_typeof(coalesce(p_translations, '{}'::jsonb)) <> 'object' then
    raise exception 'Translations must be an object'
      using errcode = 'check_violation', hint = 'serverErrors.translationsInvalid';
  end if;

  for v_language, v_entry in select e.key, e.value from jsonb_each(coalesce(p_translations, '{}'::jsonb)) e loop
    -- The apps' languages are the enum's: one added there is taken here too.
    if not exists (select 1 from unnest(enum_range(null::public.app_language)) l
                   where l::text = v_language)
       or v_language = p_language::text
       or jsonb_typeof(v_entry) <> 'object'
       or jsonb_typeof(coalesce(v_entry -> 'title', '""'::jsonb)) <> 'string'
       or jsonb_typeof(coalesce(v_entry -> 'body', '""'::jsonb)) <> 'string' then
      raise exception 'Translation % is not one the apps take', v_language
        using errcode = 'check_violation', hint = 'serverErrors.translationsInvalid';
    end if;

    v_title := btrim(coalesce(v_entry ->> 'title', ''));
    v_body := coalesce(v_entry ->> 'body', '');
    if v_title = '' and btrim(v_body) = '' then
      continue;
    end if;
    if v_title = '' then
      raise exception 'Translation % has a text and no title', v_language
        using errcode = 'check_violation', hint = 'serverErrors.kbTranslationTitleMissing',
              detail = jsonb_build_object('language', v_language)::text;
    end if;
    if char_length(v_title) > 200 then
      raise exception 'Title of translation % is longer than 200', v_language
        using errcode = 'check_violation', hint = 'serverErrors.kbTitleTooLong',
              detail = jsonb_build_object('max', 200)::text;
    end if;
    if char_length(v_body) > 20000 then
      raise exception 'Text of translation % is longer than 20000', v_language
        using errcode = 'check_violation', hint = 'serverErrors.kbBodyTooLong',
              detail = jsonb_build_object('max', 20000)::text;
    end if;

    v_clean := v_clean || jsonb_build_object(v_language,
                                             jsonb_build_object('title', v_title, 'body', v_body));
  end loop;

  return v_clean;
end;
$$;

comment on function public.kb_checked_translations(public.app_language, jsonb) is
  'The translations of a save, checked and trimmed: {"cs": {"title", "body"}, …}; an empty one dropped (20261029100000). Called by the write RPCs only.';

-- Writes the article's translations as given: the others go, the changed
-- ones are rewritten, the same ones are left alone (no version for them).
create function public.kb_write_translations(p_article uuid, p_host uuid, p_translations jsonb)
returns void
language sql
set search_path = ''
as $$
  delete from public.kb_article_translations t
  where t.article_id = p_article
    and not (p_translations ? t.language::text);

  insert into public.kb_article_translations as t (article_id, language, host_id, title, body)
  select p_article, e.key::public.app_language, p_host, e.value ->> 'title', e.value ->> 'body'
  from jsonb_each(p_translations) e
  on conflict (article_id, language) do update
    set title = excluded.title, body = excluded.body, updated_at = now()
    where (t.title, t.body) is distinct from (excluded.title, excluded.body);
$$;

comment on function public.kb_write_translations(uuid, uuid, jsonb) is
  'Replaces an article''s translations with the checked set (20261029100000). Called by the write RPCs only.';

-- What a published article must have, asked on publishing and on every save
-- while it is out.
create function public.kb_assert_publishable(p_body text, p_scope public.kb_scope, p_places integer)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if btrim(coalesce(p_body, '')) = '' then
    raise exception 'A published article needs a text'
      using errcode = 'check_violation', hint = 'serverErrors.kbBodyRequired';
  end if;
  if p_scope <> 'company' and p_places = 0 then
    raise exception 'A published article needs a place'
      using errcode = 'check_violation', hint = 'serverErrors.kbTargetsMissing';
  end if;
end;
$$;

comment on function public.kb_assert_publishable(text, public.kb_scope, integer) is
  'Refuses a published article without a text, or one that names no place where it must (20261029100000). Called by the write RPCs only.';

create function public.save_kb_article(
  p_id            uuid,
  p_language      public.app_language,
  p_title         text,
  p_body          text,
  p_translations  jsonb,
  p_scope         public.kb_scope,
  p_property_ids  bigint[],
  -- The article as the screen showed it: its updated_at, which every write
  -- moves — the text, a translation, a place, the status. Null, the default,
  -- asks nothing.
  p_expected_updated_at  timestamptz default null
)
returns public.kb_articles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host     uuid := public.current_host_id();
  v_me       uuid := (select auth.uid());
  v_title    text := btrim(coalesce(p_title, ''));
  v_body     text := coalesce(p_body, '');
  v_places   bigint[];
  v_clean    jsonb;
  v_article  public.kb_articles;
begin
  if not (public.is_manager() or public.is_head_tech()) then
    raise exception 'Only a manager or the head technician may write an article'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOrHeadTechOnly';
  end if;

  if p_id is null or p_language is null or p_scope is null then
    raise exception 'An article needs an id, a language and a scope'
      using errcode = 'check_violation', hint = 'serverErrors.kbArticleInvalid';
  end if;

  if v_title = '' then
    raise exception 'An article needs a title'
      using errcode = 'check_violation', hint = 'serverErrors.kbTitleRequired';
  end if;
  if char_length(v_title) > 200 then
    raise exception 'Title is longer than 200'
      using errcode = 'check_violation', hint = 'serverErrors.kbTitleTooLong',
            detail = jsonb_build_object('max', 200)::text;
  end if;
  if char_length(v_body) > 20000 then
    raise exception 'Text is longer than 20000'
      using errcode = 'check_violation', hint = 'serverErrors.kbBodyTooLong',
            detail = jsonb_build_object('max', 20000)::text;
  end if;

  v_clean := public.kb_checked_translations(p_language, p_translations);

  v_places := array(select distinct x from unnest(coalesce(p_property_ids, '{}')) x
                    where x is not null order by x);

  if p_scope = 'company' and cardinality(v_places) > 0 then
    raise exception 'An article for the whole company names no place'
      using errcode = 'check_violation', hint = 'serverErrors.kbTargetsInvalid';
  end if;
  if exists (select 1 from unnest(v_places) x
             where not exists (select 1 from public.properties p
                               where p.id = x and p.host_id = v_host)) then
    raise exception 'A place of the article is not in the company'
      using errcode = 'check_violation', hint = 'serverErrors.propertyNotFound';
  end if;
  if p_scope = 'building'
     and (cardinality(v_places) > 1
          or (cardinality(v_places) = 1
              and not exists (select 1 from public.properties b
                              where b.id = v_places[1] and b.parent_id is null
                                and exists (select 1 from public.properties c
                                            where c.parent_id = b.id)))) then
    raise exception 'A building article names one listing with rooms or parts under it'
      using errcode = 'check_violation', hint = 'serverErrors.kbBuildingInvalid';
  end if;

  -- A new id writes a draft. One that is taken — this article saved before, a
  -- retry racing its own first save, or another company's — is the update below,
  -- which tells them apart.
  insert into public.kb_articles (id, host_id, status, scope, language, title, body,
                                  created_by, updated_by)
  values (p_id, v_host, 'draft', p_scope, p_language, v_title, v_body, v_me, v_me)
  on conflict (id) do nothing;

  if not found then
    select a.* into v_article
    from public.kb_articles a
    where a.id = p_id and a.host_id = v_host
    for update;
    if not found then
      raise exception 'Article % not found', p_id
        using errcode = 'check_violation', hint = 'serverErrors.kbArticleNotFound';
    end if;

    if p_expected_updated_at is not null and v_article.updated_at <> p_expected_updated_at then
      -- The writer's own save, retried after its answer was lost: what is
      -- stored is what she sends, and it is that save, not a colleague's.
      if v_article.updated_by is not distinct from v_me
         and (v_article.language, v_article.title, v_article.body, v_article.scope)
             = (p_language, v_title, v_body, p_scope)
         and v_places = array(select t.property_id from public.kb_article_targets t
                              where t.article_id = p_id order by 1)
         and v_clean = coalesce((select jsonb_object_agg(t.language::text,
                                         jsonb_build_object('title', t.title, 'body', t.body))
                                 from public.kb_article_translations t
                                 where t.article_id = p_id), '{}'::jsonb) then
        return v_article;
      end if;
      raise exception 'Article % was written at %, the screen showed %',
                      p_id, v_article.updated_at, p_expected_updated_at
        using errcode = 'check_violation', hint = 'serverErrors.kbArticleChanged';
    end if;
    if v_article.status = 'published' then
      perform public.kb_assert_publishable(v_body, p_scope, cardinality(v_places));
    end if;

    update public.kb_articles
    set scope = p_scope, language = p_language, title = v_title, body = v_body, updated_by = v_me
    where id = p_id;
  end if;

  perform public.kb_write_translations(p_id, v_host, v_clean);

  delete from public.kb_article_targets t
  where t.article_id = p_id
    and t.property_id <> all (v_places);
  insert into public.kb_article_targets (article_id, property_id, host_id)
  select p_id, x, v_host from unnest(v_places) x
  on conflict (article_id, property_id) do nothing;

  select a.* into v_article from public.kb_articles a where a.id = p_id;
  return v_article;
end;
$$;

comment on function public.save_kb_article(uuid, public.app_language, text, text, jsonb, public.kb_scope, bigint[], timestamptz) is
  'Creates (as a draft) or rewrites a knowledge base article: its original, translations and places. A manager or the head technician; idempotent by the id the panel minted; p_expected_updated_at null asks nothing (20261029100000).';

create function public.set_kb_article_status(p_id uuid, p_status public.kb_status)
returns public.kb_articles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_article public.kb_articles;
begin
  v_article := public.kb_article_for_writer(p_id);

  if p_status is null then
    raise exception 'A status is required'
      using errcode = 'check_violation', hint = 'serverErrors.kbArticleInvalid';
  end if;
  if v_article.status = p_status then
    return v_article;
  end if;

  if p_status = 'published' then
    perform public.kb_assert_publishable(
      v_article.body, v_article.scope,
      (select count(*)::int from public.kb_article_targets t where t.article_id = p_id));
  end if;

  update public.kb_articles
  set status = p_status,
      published_at = case when p_status = 'published' then now() else published_at end,
      updated_by = (select auth.uid())
  where id = p_id
  returning * into v_article;

  return v_article;
end;
$$;

comment on function public.set_kb_article_status(uuid, public.kb_status) is
  'Publishes, takes back to a draft or archives a knowledge base article; a manager or the head technician (20261029100000).';

create function public.restore_kb_revision(
  p_article_id    uuid,
  p_rev           integer,
  -- The article as the screen showed it (its updated_at). Null, the default, asks nothing.
  p_expected_updated_at  timestamptz default null
)
returns public.kb_articles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_article  public.kb_articles;
  v_revision public.kb_article_revisions;
begin
  v_article := public.kb_article_for_writer(p_article_id);

  if p_expected_updated_at is not null and v_article.updated_at <> p_expected_updated_at then
    raise exception 'Article % was written at %, the screen showed %',
                    p_article_id, v_article.updated_at, p_expected_updated_at
      using errcode = 'check_violation', hint = 'serverErrors.kbArticleChanged';
  end if;

  select r.* into v_revision
  from public.kb_article_revisions r
  where r.article_id = p_article_id and r.rev = p_rev;
  if not found then
    raise exception 'Article % has no version %', p_article_id, p_rev
      using errcode = 'check_violation', hint = 'serverErrors.kbRevisionNotFound',
            detail = jsonb_build_object('rev', p_rev)::text;
  end if;

  if v_article.status = 'published' then
    perform public.kb_assert_publishable(
      v_revision.body, v_article.scope,
      (select count(*)::int from public.kb_article_targets t where t.article_id = p_article_id));
  end if;

  update public.kb_articles
  set language = v_revision.language, title = v_revision.title, body = v_revision.body,
      updated_by = (select auth.uid())
  where id = p_article_id;

  perform public.kb_write_translations(p_article_id, v_article.host_id, v_revision.translations);

  select a.* into v_article from public.kb_articles a where a.id = p_article_id;
  return v_article;
end;
$$;

comment on function public.restore_kb_revision(uuid, integer, timestamptz) is
  'Brings a version of a knowledge base article back as its newest version, text and translations; a manager or the head technician; p_expected_updated_at null asks nothing (20261029100000).';

-- ---------- who may call what ----------

revoke all on function public.kb_snapshot(uuid) from public, anon, authenticated;
revoke all on function public.kb_articles_version() from public, anon, authenticated;
revoke all on function public.kb_articles_snapshot() from public, anon, authenticated;
revoke all on function public.kb_translations_version() from public, anon, authenticated;
revoke all on function public.kb_article_for_writer(uuid) from public, anon, authenticated;
revoke all on function public.kb_checked_translations(public.app_language, jsonb)
  from public, anon, authenticated;
revoke all on function public.kb_write_translations(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.kb_assert_publishable(text, public.kb_scope, integer)
  from public, anon, authenticated;
-- A service script that writes an article directly still makes its version.
grant execute on function public.kb_snapshot(uuid) to service_role;

revoke all on function public.kb_reader_property_ids() from public, anon;
revoke all on function public.kb_staff_article_ids() from public, anon;
grant execute on function public.kb_reader_property_ids() to authenticated, service_role;
grant execute on function public.kb_staff_article_ids() to authenticated, service_role;

revoke all on function public.save_kb_article(uuid, public.app_language, text, text, jsonb,
                                              public.kb_scope, bigint[], timestamptz)
  from public, anon;
revoke all on function public.set_kb_article_status(uuid, public.kb_status) from public, anon;
revoke all on function public.restore_kb_revision(uuid, integer, timestamptz) from public, anon;
grant execute on function public.save_kb_article(uuid, public.app_language, text, text, jsonb,
                                                 public.kb_scope, bigint[], timestamptz)
  to authenticated, service_role;
grant execute on function public.set_kb_article_status(uuid, public.kb_status)
  to authenticated, service_role;
grant execute on function public.restore_kb_revision(uuid, integer, timestamptz)
  to authenticated, service_role;
