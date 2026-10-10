-- Before and after the db push of 20261010100000_video_from_gallery (owner's plan
-- of 2026-10-10, block 4). Read-only, one statement, no personal data:
--
--   node scripts/cloud-read.mjs docs/rollout/gallery_video_probe.sql
--
--   head        the cloud's last migration: 20261008100000 before, 20261010100000 after.
--   rpc         add_task_media as the migration's header says it stays: the same ten
--               arguments, security definer, search_path '', the same ACL
--               {postgres=X, authenticated=X, service_role=X}, one overload. Only the
--               body changes: camera_only true -> false, gallery_check stays true;
--               md5 e22633c9a01202e91eafca33cd6ec97d before (= 20261003170000),
--               1aae2aacfa15c47fd6e871af7de40ddf after (the local database with the
--               migration, measured in a rolled-back transaction).
--   hosts       the company's gallery switch and video numbers (unchanged by the push).
--   gallery     videos from the gallery already in task_media: 0 before; grows only
--               once the phones carry the bundle that offers the gallery.
select json_build_object(
  'head', (select max(version) from supabase_migrations.schema_migrations),
  'rpc', (select json_agg(json_build_object(
            'args', pg_get_function_identity_arguments(p.oid),
            'security_definer', p.prosecdef,
            'config', p.proconfig,
            'acl', p.proacl::text,
            'camera_only', p.prosrc like '%videoCameraOnly%',
            'gallery_check', p.prosrc like '%galleryNotAllowed%',
            'md5', md5(p.prosrc)))
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'add_task_media'),
  'hosts', (select json_agg(json_build_object(
              'gallery_allowed', h.gallery_allowed,
              'video_max_sec', h.video_max_sec,
              'video_max_mb', h.video_max_mb))
            from public.hosts h),
  'gallery', (select count(*) from public.task_media m
              where m.kind = 'video' and m.source = 'gallery')
) as probe;
