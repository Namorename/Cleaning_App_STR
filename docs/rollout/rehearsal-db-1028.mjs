// A throwaway database for rehearsing a rollout (docs/rollout-plan-1028.md §6.1), inside the
// local Supabase container but apart from the shared stand: the stand's own database
// (`postgres`) is only read by pg_dump, never written, and no db:reset is needed.
//
//   node docs/rollout/rehearsal-db-1028.mjs create   # fresh database, every migration of this tree
//   node docs/rollout/rehearsal-db-1028.mjs suites   # every supabase/tests/*.sql against it
//   node docs/rollout/rehearsal-db-1028.mjs drop
//
// Types from it, without touching the stand:
//   npx supabase gen types typescript --db-url postgresql://postgres:postgres@127.0.0.1:54322/rehearsal_1028 \
//     --schema public,graphql_public
//
// How it is built:
//   1. create database from template0, owned by postgres;
//   2. the platform's schemas from a schema-only dump of the stand without public, raw and
//      supabase_migrations, with our own objects in other schemas cut out (two storage.objects
//      policies, two auth.users triggers, postgres's global default for functions) and pg_cron
//      cut out: the extension lives only in the database cron.database_name names, so a stub
//      schema cron with the same signatures stands in for it;
//   3. the public schema as the image's init-scripts/00000000000000-initial-schema.sql leaves it;
//   4. every migration in filename order, one transaction each, as postgres, the way the CLI
//      applies them; `create extension if not exists pg_cron;` is the stub's.
// Run from the root of the tree whose catalog is rehearsed. Heavy steps go through testlock.mjs.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const DB = 'rehearsal_1028';
const projectId = readFileSync('supabase/config.toml', 'utf8').match(/^project_id\s*=\s*"([^"]+)"/m);
if (!projectId) {
  console.error('no project_id in supabase/config.toml');
  process.exit(1);
}
const CONTAINER = `supabase_db_${projectId[1]}`;

function run(args, input) {
  const res = spawnSync('docker', ['exec', '-i', CONTAINER, ...args], {
    input,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  return { ok: res.status === 0, out: res.stdout ?? '', err: res.stderr ?? '' };
}

function psql(user, database, sql, extra = []) {
  const res = run(['psql', '-U', user, '-d', database, '-v', 'ON_ERROR_STOP=1', '-q', '-X', ...extra], sql);
  return { ok: res.ok, out: `${res.out}${res.err}` };
}

function must(label, result) {
  if (!result.ok) {
    console.error(`FAILED: ${label}\n${result.out.slice(-4000)}`);
    process.exit(1);
  }
  console.log(`ok: ${label}`);
}

// pg_dump separates objects with "--\n-- Name: …; Type: …; Schema: …; Owner: …" headers.
const DROP_BLOCKS = [
  /^Name: pg_cron; Type: EXTENSION/,
  /^Name: EXTENSION pg_cron; Type: COMMENT/,
  /; Schema: cron;/,
  /^Name: SCHEMA cron; Type: ACL/,
  /^Name: users on_auth_user_created; Type: TRIGGER/,
  /^Name: users on_auth_user_email_changed; Type: TRIGGER/,
  /^Name: objects cleaner uploads the file her row is waiting for; Type: POLICY/,
  /^Name: objects task media is read by whoever reads its row; Type: POLICY/,
  /^Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: -; Owner: postgres/,
];

function platformSchemas() {
  const dump = run(['pg_dump', '-U', 'supabase_admin', '-d', 'postgres', '--schema-only',
    '--exclude-schema=public', '--exclude-schema=raw', '--exclude-schema=supabase_migrations']);
  if (!dump.ok) {
    console.error(`pg_dump failed\n${dump.err.slice(-2000)}`);
    process.exit(1);
  }
  const kept = [];
  const dropped = [];
  for (const part of dump.out.split('\n--\n-- ')) {
    if (DROP_BLOCKS.some((re) => re.test(part))) dropped.push(part.split('\n')[0]);
    else kept.push(part);
  }
  const missing = DROP_BLOCKS.filter((re) => !dropped.some((line) => re.test(line)));
  if (missing.length > 0) {
    console.error(`not in the dump, check the filter: ${missing.join(' | ')}`);
    process.exit(1);
  }
  const text = kept.join('\n--\n-- ');
  const leftover = text.match(/\bpublic\.[a-z_]+\(/);
  if (leftover) {
    console.error(`an object of ours survived the filter: ${leftover[0]}`);
    process.exit(1);
  }
  console.log(`platform schemas: ${dropped.length} blocks cut`);
  return text;
}

const PUBLIC_AS_POSTGRES = `
grant usage on schema public to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;
`;
const PUBLIC_AS_ADMIN = `
alter default privileges for user supabase_admin in schema public grant all on sequences to postgres, anon, authenticated, service_role;
alter default privileges for user supabase_admin in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges for user supabase_admin in schema public grant all on functions to postgres, anon, authenticated, service_role;
`;

// Enough of pg_cron for the migrations and the suites, with pg_cron's signatures and rights:
// postgres reads cron.job and writes the run log; schedule/unschedule/alter_job act as the owner.
const CRON_STUB = `
create schema cron;
create table cron.job (
  jobid bigserial primary key,
  schedule text not null,
  command text not null,
  nodename text not null default 'localhost',
  nodeport integer not null default 5432,
  database text not null default current_database(),
  username text not null default current_user,
  active boolean not null default true,
  jobname text unique
);
create table cron.job_run_details (
  jobid bigint,
  runid bigint primary key,
  job_pid integer,
  database text,
  username text,
  command text,
  status text,
  return_message text,
  start_time timestamptz,
  end_time timestamptz
);
create function cron.schedule(job_name text, schedule text, command text) returns bigint
language sql security definer set search_path = cron, pg_catalog as $$
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid
$$;
create function cron.unschedule(job_name text) returns boolean
language sql security definer set search_path = cron, pg_catalog as $$
  with gone as (delete from cron.job where jobname = job_name returning 1)
  select exists (select 1 from gone)
$$;
create function cron.unschedule(job_id bigint) returns boolean
language sql security definer set search_path = cron, pg_catalog as $$
  with gone as (delete from cron.job where jobid = job_id returning 1)
  select exists (select 1 from gone)
$$;
create function cron.alter_job(job_id bigint, schedule text default null, command text default null,
  database text default null, username text default null, active boolean default null) returns void
language sql security definer set search_path = cron, pg_catalog as $$
  update cron.job j set
    schedule = coalesce(alter_job.schedule, j.schedule),
    command = coalesce(alter_job.command, j.command),
    active = coalesce(alter_job.active, j.active)
  where j.jobid = job_id
$$;
grant usage on schema cron to postgres;
grant select on table cron.job to postgres with grant option;
grant all on table cron.job_run_details to postgres with grant option;
grant all on all sequences in schema cron to postgres with grant option;
grant all on all functions in schema cron to postgres with grant option;
`;

const MIGRATION_LOG = `
create schema supabase_migrations;
create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);
alter schema supabase_migrations owner to postgres;
alter table supabase_migrations.schema_migrations owner to postgres;
`;

function create() {
  must('create database', psql('supabase_admin', 'postgres',
    `create database ${DB} with template template0 owner postgres encoding 'UTF8' ` +
    `lc_collate 'en_US.UTF-8' lc_ctype 'en_US.UTF-8';`));
  must('platform schemas', psql('supabase_admin', DB, platformSchemas()));
  must('public as postgres', psql('postgres', DB, PUBLIC_AS_POSTGRES));
  must('public as supabase_admin', psql('supabase_admin', DB, PUBLIC_AS_ADMIN));
  must('cron stub', psql('supabase_admin', DB, CRON_STUB));
  must('migration log', psql('supabase_admin', DB, MIGRATION_LOG));
  const files = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort();
  for (const name of files) {
    const sql = readFileSync(join('supabase/migrations', name), 'utf8')
      .replace(/^\s*create extension if not exists pg_cron;\s*$/im, '-- rehearsal: the stub schema cron');
    const version = name.split('_')[0];
    const record = `\ninsert into supabase_migrations.schema_migrations (version, name) ` +
      `values ('${version}', '${name.slice(version.length + 1, -4)}');\n`;
    const res = psql('postgres', DB, sql + record, ['--single-transaction']);
    if (!res.ok) {
      console.error(`FAILED migration ${name}\n${res.out.slice(-4000)}`);
      process.exit(1);
    }
  }
  console.log(`ok: ${files.length} migrations, last ${files.at(-1)}`);
}

function suites() {
  const names = readdirSync('supabase/tests').filter((n) => n.endsWith('.sql')).sort();
  let red = 0;
  let checks = 0;
  for (const name of names) {
    const res = psql('postgres', DB, readFileSync(join('supabase/tests', name), 'utf8'));
    const passed = (res.out.match(/NOTICE:\s+ok/g) ?? []).length;
    checks += passed;
    const failed = !res.ok || /ERROR:|FAIL/.test(res.out);
    if (failed) red += 1;
    const firstBad = res.out.split('\n').find((line) => /ERROR:|FAIL/.test(line)) ?? '';
    console.log(`${failed ? 'RED  ' : 'green'} ${name} ${passed}${failed ? ` ${firstBad.trim().slice(0, 200)}` : ''}`);
  }
  console.log(`suites ${names.length}, red ${red}, checks passed ${checks}`);
  process.exit(red > 0 ? 1 : 0);
}

const command = process.argv[2];
if (command === 'create') create();
else if (command === 'suites') suites();
else if (command === 'drop') must('drop database', psql('supabase_admin', 'postgres', `drop database if exists ${DB} with (force);`));
else {
  console.error('usage: node docs/rollout/rehearsal-db-1028.mjs create|suites|drop');
  process.exit(2);
}
