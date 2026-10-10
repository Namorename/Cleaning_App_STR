import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { apiUrl, eventSummary, fillPath, pickFields, redact } from '../sentry-get.mjs';

const LIVE = 'https://de.sentry.io/api/0';
const SCRIPT = fileURLToPath(new URL('../sentry-get.mjs', import.meta.url));

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

test('fills the organization and project placeholders', () => {
  const names = { org: 'acme', project: 'phone', projectId: '42' };
  assert.equal(
    fillPath('organizations/{org}/issues/?project={projectId}', names),
    'organizations/acme/issues/?project=42',
  );
  assert.equal(fillPath('projects/{org}/{project}/events/abc/', names), 'projects/acme/phone/events/abc/');
  assert.equal(fillPath('organizations/', names), 'organizations/');
});

test('the slugs the token resolved never reach the output', () => {
  const names = { org: 'acme', project: 'phone', projectId: '42' };
  const text = redact('{"permalink":"https://acme.sentry.io/issues/1/","project":{"slug":"phone","id":"42"}}', names);
  assert.ok(!text.includes('acme'));
  assert.ok(!text.includes('"phone"'));
  assert.ok(text.includes('{org}'));
  assert.ok(text.includes('{project}'));
});

test('picks dotted fields from each item', () => {
  const items = [{ title: 'A', count: '3', metadata: { value: 'v', filename: 'f' }, user: { email: 'x@y' } }];
  assert.deepEqual(pickFields(items, ['title', 'count', 'metadata.value']), [
    { title: 'A', count: '3', 'metadata.value': 'v' },
  ]);
});

test('an event summary keeps the stack and the release, not the person', () => {
  const event = {
    eventID: 'e1',
    dateCreated: '2026-10-09T21:55:00Z',
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
  const summary = eventSummary(event, 1);
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

test('asks the stand-in with GET and the stored token, and never prints the token', async () => {
  const token = 'sntryu_test_token_never_printed';
  const dir = mkdtempSync(join(tmpdir(), 'sentry-get-'));
  const tokenFile = join(dir, 'token.txt');
  writeFileSync(tokenFile, `${token}\n`);
  const seen = [];
  const server = createServer((request, response) => {
    seen.push({ method: request.method, url: request.url, auth: request.headers.authorization });
    const body =
      request.url === '/organizations/'
        ? [{ slug: 'acme' }]
        : request.url === '/organizations/acme/projects/'
          ? [{ slug: 'phone', id: '42' }]
          : [{ title: 'Boom', count: '2', permalink: 'https://acme.sentry.io/issues/7/' }];
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const result = await run(['organizations/{org}/issues/?project={projectId}', '--pick', 'title,count,permalink'], {
      SENTRY_GET_BASE_URL: `http://127.0.0.1:${port}`,
      SENTRY_GET_TOKEN_FILE: tokenFile,
    });
    assert.equal(result.code, 0, result.stderr);
    assert.ok(!result.stdout.includes(token));
    assert.ok(!result.stderr.includes(token));
    assert.ok(!result.stdout.includes('acme'));
    assert.deepEqual(JSON.parse(result.stdout), [
      { title: 'Boom', count: '2', permalink: 'https://{org}.sentry.io/issues/7/' },
    ]);
    assert.ok(seen.every((request) => request.method === 'GET'));
    assert.ok(seen.every((request) => request.auth === `Bearer ${token}`));
    assert.equal(seen.at(-1).url, '/organizations/acme/issues/?project=42');
  } finally {
    server.close();
  }
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

test('prints nothing raw: a path needs --pick, --count or --event', async () => {
  const result = await run(['organizations/'], { SENTRY_GET_BASE_URL: 'http://127.0.0.1:9' });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /--pick/);
});
