// The Reviews demo on the LOCAL stand only: the local database container of
// supabase/config.toml, never the cloud. Synthetic rows (supabase/demo/reviews-demo.sql).
//   node scripts/reviews-demo.mjs check  — the migration (if missing) and the demo in one
//                                          transaction that is rolled back: nothing stays
//   node scripts/reviews-demo.mjs up     — the same, committed: the panel can show it
//   node scripts/reviews-demo.mjs down   — the demo tasks and the whole reviews schema go
//                                          (the rollback file); the stand is as before up
// The migration is applied outside the migration history; take the demo down before a
// `migration up` or a reset of the stand.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const MIGRATION = 'supabase/migrations/20261017110000_reviews_to_tasks.sql';
const DEMO = 'supabase/demo/reviews-demo.sql';
const ROLLBACK = 'docs/one-off-writes/reviews-to-tasks-rollback.sql';

const project = readFileSync('supabase/config.toml', 'utf8').match(/^project_id\s*=\s*"([^"]+)"/m);
if (!project) {
  console.error('No project_id in supabase/config.toml');
  process.exit(1);
}
const container = `supabase_db_${project[1]}`;

function psql(input) {
  const res = spawnSync(
    'docker',
    ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-At'],
    { input, encoding: 'utf8', shell: process.platform === 'win32' },
  );
  if (res.status !== 0) {
    console.error(`${res.stdout ?? ''}${res.stderr ?? ''}`.trim());
    process.exit(res.status ?? 1);
  }
  return (res.stdout ?? '').trim();
}

const read = (path) => `${readFileSync(path, 'utf8')}\n`;
const hasSchema = psql("select to_regclass('public.guest_reviews') is not null;") === 't';

const COUNTS = `
select 'reviews ' || count(*) from public.guest_reviews where external_id like 'demo-review-%';
select 'finding ' || status || ' ' || count(*) from public.review_findings group by status order by status;
select 'tasks from reviews ' || count(*) from public.problems where source = 'review';
`;

// The demo's tasks first: the rollback refuses while a task from a review exists.
const DROP_DEMO_TASKS = `
delete from raw.push_outbox o
 where o.params ->> 'problem_id' in (select id::text from public.problems where source = 'review');
delete from public.problem_events e where e.problem_id in (select id from public.problems where source = 'review');
delete from public.problems where source = 'review';
`;

const mode = process.argv[2];
if (mode === 'check' || mode === 'up') {
  const end = mode === 'check' ? 'rollback;' : 'commit;';
  console.log(psql(`begin;\n${hasSchema ? '' : read(MIGRATION)}${read(DEMO)}${COUNTS}${end}\n`));
  console.log(mode === 'check' ? 'checked and rolled back: the stand is unchanged' : 'demo is on the stand');
} else if (mode === 'down') {
  if (!hasSchema) {
    console.log('no reviews schema on the stand: nothing to take down');
    process.exit(0);
  }
  psql(`begin;\n${DROP_DEMO_TASKS}${read(ROLLBACK)}commit;\n`);
  console.log('demo and reviews schema taken off the stand');
} else {
  console.error('Usage: node scripts/reviews-demo.mjs check|up|down');
  process.exit(2);
}
