import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

import { refusal } from '../cloud-read.mjs';

const ROLLOUT_DIR = new URL('../../docs/rollout/', import.meta.url);
const CRON_ARGS = "'x', '* * * * *', 'select 1'";

test('passes plain reads', () => {
  const reads = [
    'select count(*) from public.properties',
    'with t as (select 1 as n) select n from t;',
    'select 1; -- a trailing comment',
    'explain select 1',
    'select jobname, schedule from cron.job',
    'select "jobname" from "cron"."job"',
    "select 'cron.schedule(' as text",
    "select E'it\\'s' as text",
    'select $x$ cron.schedule( $x$ as text',
    "select set_config('request.jwt.claims', '{}', true)",
  ];
  for (const query of reads) {
    assert.equal(refusal(query), null, query);
  }
});

test('passes every rollout check in docs/rollout', () => {
  const files = readdirSync(ROLLOUT_DIR).filter((name) => name.endsWith('.sql'));
  assert.ok(files.length > 0);
  for (const name of files) {
    assert.equal(refusal(readFileSync(new URL(name, ROLLOUT_DIR), 'utf8')), null, name);
  }
});

const REFUSED = [
  ['a schema-qualified cron call', `select cron.schedule(${CRON_ARGS})`],
  ['an upper-case cron call', `SELECT CRON.SCHEDULE(${CRON_ARGS})`],
  ['a bare cron call', `select schedule(${CRON_ARGS})`],
  ['a bare call after SET search_path', `SET search_path = cron, public; SELECT schedule(${CRON_ARGS})`],
  ['a bare call after set_config', `select set_config('search_path', 'cron', true); select schedule(${CRON_ARGS})`],
  ['quoted identifiers', `select "cron"."schedule"(${CRON_ARGS})`],
  ['comments between the names', `select cron/**/./**/schedule(${CRON_ARGS})`],
  ['a comment marker inside a string', `select '--', cron.schedule(${CRON_ARGS})`],
  ['a call after a dollar-quoted string', 'select $$ $$, cron.unschedule(1)'],
  ['a call after an escaped E-string', "select E'\\'', cron.unschedule(1)"],
  ['a unicode-escaped identifier', `select U&"\\0063ron".schedule(${CRON_ARGS})`],
  ['a DO block', `do $$ begin perform cron.schedule(${CRON_ARGS}); end $$`],
  ['SQL run from a string', "select query_to_xml('select cron.sch' || 'edule(1)', true, false, '')"],
  ['ts_stat', "select ts_stat('select 1')"],
  ['pg_net', 'select net.worker_restart()'],
  ['quoted pg_net', 'select "net".wake()'],
  ['bare pg_net', 'select wake()'],
  ['large objects', "select lo_import('/etc/passwd')"],
  ['lowrite', 'select lowrite(0, null)'],
  ['dblink', "select dblink_exec('x', 'y')"],
  ['notifications', "select pg_notify('pgrst', 'reload schema')"],
  ['transaction control', 'begin; select 1; commit'],
  ['changing the transaction mode', 'set transaction read write; select 1'],
  ['set_config of anything but claims', "select set_config('transaction_read_only', 'off', false)"],
  ['prepared statements', 'prepare p as select 1; execute p'],
  ['an unterminated string', "select 'open"],
  ['an unterminated comment', 'select 1 /* open'],
];

for (const [what, query] of REFUSED) {
  test(`refuses ${what}`, () => {
    assert.notEqual(refusal(query), null, query);
  });
}
