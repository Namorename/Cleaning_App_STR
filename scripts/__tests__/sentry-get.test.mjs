import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { apiUrl as hostawayApiUrl } from '../hostaway-get.mjs';
import { apiUrl, eventSummary, fillPath, parseArgs, pickFields, redact } from '../sentry-get.mjs';

const LIVE = 'https://de.sentry.io/api/0';
const SCRIPT = fileURLToPath(new URL('../sentry-get.mjs', import.meta.url));
const NAMES = { org: 'acme', project: 'phone', projectId: '42' };

test('builds request urls under the API root', () => {
  assert.equal(apiUrl(LIVE, 'organizations/')?.href, 'https://de.sentry.io/api/0/organizations/');
  assert.equal(
    apiUrl(LIVE, 'organizations/acme/issues/?limit=5')?.href,
    'https://de.sentry.io/api/0/organizations/acme/issues/?limit=5',
  );
  assert.equal(apiUrl('http://127.0.0.1:4010', 'organizations/')?.href, 'http://127.0.0.1:4010/organizations/');
});

test('refuses paths that would leave the API root', () => {
  const escapes = [
    '../auth/',
    '%2e%2e/auth/',
    '.%2e/auth/',
    'organizations/%2e%2e/%2e%2e/auth/',
    'organizations%2f..%2fauth',
    'organizations\\..\\auth',
    '/auth/',
    '//evil.example/x',
    'https://evil.example/x',
    '.\t./auth/',
    ' https://evil.example/x',
  ];
  for (const path of escapes) {
    assert.equal(apiUrl(LIVE, path), null, JSON.stringify(path));
  }
});

// sentry-get.mjs is pinned by hash and self-contained, so it keeps its own copy
// of the path rules; this keeps the copy from drifting from hostaway-get.mjs.
test('the path rules are the same as hostaway-get.mjs', () => {
  assert.equal(apiUrl.toString(), hostawayApiUrl.toString());
});

test('fills the organization and project placeholders', () => {
  assert.equal(
    fillPath('organizations/{org}/issues/?project={projectId}', NAMES),
    'organizations/acme/issues/?project=42',
  );
  assert.equal(fillPath('projects/{org}/{project}/events/abc/', NAMES), 'projects/acme/phone/events/abc/');
  assert.equal(fillPath('organizations/', NAMES), 'organizations/');
});

test('the slugs never reach the output, in any case or company', () => {
  const text = redact(
    JSON.stringify({
      permalink: 'https://acme.sentry.io/issues/1/',
      project: { slug: 'phone', id: '42' },
      shortId: 'PHONE-1A',
      environment: 'acme_prod',
    }),
    NAMES,
  );
  assert.ok(!/acme/i.test(text), text);
  assert.ok(!/phone/i.test(text), text);
  assert.ok(text.includes('{project}-1A'), text);
  assert.ok(text.includes('{org}_prod'), text);
});

test('a project named after its organization is taken out whole', () => {
  const names = { org: 'str-ops', project: 'str-ops-phone' };
  assert.equal(redact('str-ops-phone in str-ops', names), '{project} in {org}');
});

test('a slug inside a longer word is left alone', () => {
  assert.equal(redact('telephone acmeish', NAMES), 'telephone acmeish');
});

test('picks dotted fields from each item', () => {
  const items = [{ title: 'A', count: '3', metadata: { value: 'v', filename: 'f' }, user: { email: 'x@y' } }];
  assert.deepEqual(pickFields(items, ['title', 'count', 'metadata.value']), [
    { title: 'A', count: '3', 'metadata.value': 'v' },
  ]);
});

const EVENT = {
  eventID: 'e1',
  dateCreated: '2026-10-09T21:55:00Z',
  title: 'TypeError: in phone',
  user: { id: 'u1', email: 'maid@example.test', ip_address: '10.0.0.1' },
  tags: [
    { key: 'release', value: 'com.example@1.2.0+1' },
    { key: 'dist', value: '1' },
    { key: 'user', value: 'id:u1' },
    { key: 'url', value: 'https://example.test/secret' },
  ],
  entries: [
    { type: 'breadcrumbs', data: { values: [{ message: 'maid@example.test' }] } },
    {
      type: 'exception',
      data: {
        values: [
          {
            type: 'TypeError',
            value: 'undefined is not a function',
            mechanism: { type: 'onerror', handled: false },
            stacktrace: {
              frames: [
                { filename: 'a.js', function: 'outer', lineNo: 1, colNo: 2, inApp: true },
                { filename: 'b.js', function: 'inner', lineNo: 3, colNo: 4, inApp: false },
              ],
            },
          },
        ],
      },
    },
  ],
};

test('an event summary keeps the stack and the release, not the person', () => {
  const summary = eventSummary(EVENT, 1);
  assert.equal(summary.eventID, 'e1');
  assert.deepEqual(summary.tags, { release: 'com.example@1.2.0+1', dist: '1' });
  assert.equal(summary.exceptions[0].type, 'TypeError');
  assert.equal(summary.exceptions[0].handled, false);
  // The top of the stack is the last frame; one frame asked, one given.
  assert.deepEqual(summary.exceptions[0].frames, [
    { filename: 'b.js', function: 'inner', line: 3, column: 4, inApp: false },
  ]);
  const text = JSON.stringify(summary);
  assert.ok(!text.includes('maid@example.test'));
  assert.ok(!text.includes('10.0.0.1'));
  assert.ok(!text.includes('secret'));
});

test('reads one way to print, and --event takes a frame count only when one follows', () => {
  assert.deepEqual(parseArgs(['issues/', '--event', '3']), {
    path: 'issues/',
    mode: 'event',
    pick: null,
    frames: 3,
  });
  assert.equal(parseArgs(['issues/', '--event']).frames, 8);
  assert.match(parseArgs(['issues/', '--event', 'x']).error, /unknown option x/);
  assert.match(parseArgs(['issues/', '--count', '--event']).error, /exactly one/);
  assert.match(parseArgs(['issues/']).error, /exactly one/);
  assert.match(parseArgs(['--count']).error, /usage/);
  assert.match(parseArgs(['../auth/', '--count']).error, /relative to \/api\/0/);
});

function run(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

const TOKEN = 'sntryu_test_token_never_printed';

/** A loopback Sentry with one organization, one project and the given answer. */
async function withStandIn(answer, check) {
  const dir = mkdtempSync(join(tmpdir(), 'sentry-get-'));
  const tokenFile = join(dir, 'token.txt');
  writeFileSync(tokenFile, `${TOKEN}\n`);
  const seen = [];
  const server = createServer((request, response) => {
    seen.push({ method: request.method, url: request.url, auth: request.headers.authorization });
    const body =
      request.url === '/organizations/'
        ? [{ slug: 'acme' }]
        : request.url === '/organizations/acme/projects/'
          ? [{ slug: 'phone', id: '42' }]
          : answer;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const env = {
    SENTRY_GET_BASE_URL: `http://127.0.0.1:${server.address().port}`,
    SENTRY_GET_TOKEN_FILE: tokenFile,
  };
  try {
    await check(env, seen);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('asks the stand-in with GET and the stored token, and never prints the token', async () => {
  await withStandIn(
    [{ title: 'Boom', count: '2', permalink: 'https://acme.sentry.io/issues/7/' }],
    async (env, seen) => {
      const result = await run(
        ['organizations/{org}/issues/?project={projectId}', '--pick', 'title,count,permalink'],
        env,
      );
      assert.equal(result.code, 0, result.stderr);
      assert.ok(!result.stdout.includes(TOKEN));
      assert.ok(!result.stderr.includes(TOKEN));
      assert.ok(!result.stdout.includes('acme'));
      assert.deepEqual(JSON.parse(result.stdout), [
        { title: 'Boom', count: '2', permalink: 'https://{org}.sentry.io/issues/7/' },
      ]);
      assert.ok(seen.every((request) => request.method === 'GET'));
      assert.ok(seen.every((request) => request.auth === `Bearer ${TOKEN}`));
      assert.equal(seen.at(-1).url, '/organizations/acme/issues/?project=42');
    },
  );
});

test('the slugs are taken out even when the path names neither', async () => {
  await withStandIn([{ slug: 'acme' }], async (env) => {
    const result = await run(['organizations/', '--pick', 'slug'], env);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), [{ slug: '{org}' }]);
  });
});

test('--event prints the summary end to end, without the person', async () => {
  await withStandIn(EVENT, async (env) => {
    const result = await run(['projects/{org}/{project}/events/e1/', '--event', '2'], env);
    assert.equal(result.code, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.title, 'TypeError: in {project}');
    assert.equal(summary.exceptions[0].frames.length, 2);
    assert.ok(!result.stdout.includes('maid@example.test'));
    assert.ok(!result.stdout.includes('10.0.0.1'));
  });
});

test('refuses a non-loopback override and a missing token file', async () => {
  const away = await run(['organizations/', '--count'], { SENTRY_GET_BASE_URL: 'http://evil.example:80' });
  assert.notEqual(away.code, 0);
  assert.match(away.stderr, /loopback/);
  const missing = await run(['organizations/', '--count'], {
    SENTRY_GET_BASE_URL: 'http://127.0.0.1:9',
    SENTRY_GET_TOKEN_FILE: join(tmpdir(), 'no-such-sentry-token.txt'),
  });
  assert.notEqual(missing.code, 0);
  assert.match(missing.stderr, /no token file/);
});

test('prints nothing whole: a path needs --pick, --count or --event', async () => {
  const result = await run(['organizations/'], { SENTRY_GET_BASE_URL: 'http://127.0.0.1:9' });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /--pick/);
});
