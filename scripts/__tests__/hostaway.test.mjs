import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { apiUrl } from '../hostaway-get.mjs';

const LIVE = 'https://api.hostaway.com/v1';

test('builds request urls under the API root', () => {
  assert.equal(apiUrl(LIVE, 'listings')?.href, 'https://api.hostaway.com/v1/listings');
  assert.equal(
    apiUrl(LIVE, 'reservations?limit=5')?.href,
    'https://api.hostaway.com/v1/reservations?limit=5',
  );
  assert.equal(apiUrl('http://127.0.0.1:4010', 'listings')?.href, 'http://127.0.0.1:4010/listings');
});

test('refuses paths that would leave the API root', () => {
  const escapes = [
    '../accessTokens',
    '%2e%2e/accessTokens',
    '.%2e/accessTokens',
    '%2E./accessTokens',
    'listings/%2e%2e/%2e%2e/accessTokens',
    'listings%2f..%2faccessTokens',
    'listings\\..\\accessTokens',
    'listings/%5c/x',
    '/accessTokens',
    '//evil.example/x',
    'https://evil.example/x',
  ];
  for (const path of escapes) {
    assert.equal(apiUrl(LIVE, path), null, path);
  }
});

// new URL() drops tabs and newlines anywhere and spaces at the ends, so these
// pass every check on the text of the path and are caught only by the check on
// the URL fetch() would use.
test('checks the url fetch() will use, not only the text of the path', () => {
  const escapes = [
    '.\t./accessTokens',
    ' /accessTokens',
    '\t//evil.example/x',
    ' https://evil.example/x',
    '\t//evil.example/v1/x',
  ];
  for (const path of escapes) {
    assert.equal(apiUrl(LIVE, path), null, JSON.stringify(path));
  }
});

// These stay under /v1 in the parsed URL; a server that decodes them could
// still step out, so each is refused by a check on the text of its own.
test('refuses what a server might decode into a segment of its own', () => {
  for (const path of ['x%2e%2e', 'listings%2fx', 'listings\\x', 'listings/..x']) {
    assert.equal(apiUrl(LIVE, path), null, path);
  }
});

// hostaway-get.mjs is pinned by hash and must stay self-contained (see its
// header), so the two scripts keep their own copies of these rules. This test
// is what keeps the copies from drifting apart.
test('both Hostaway scripts share the same base-url and token-file rules', () => {
  const read = (name) =>
    readFileSync(new URL(`../${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const rules = (source) =>
    ['const LIVE_BASE_URL', 'function baseUrl()', 'function tokenFile()'].map((head) => {
      const start = source.indexOf(head);
      assert.ok(start >= 0, head);
      const isConst = head.startsWith('const');
      const close = source.indexOf(isConst ? '\n' : '\n}\n', start);
      assert.ok(close > start, `${head} has no end`);
      return source.slice(start, isConst ? close : close + 2);
    });
  assert.deepEqual(rules(read('hostaway-get.mjs')), rules(read('hostaway-issue-token.mjs')));
});
