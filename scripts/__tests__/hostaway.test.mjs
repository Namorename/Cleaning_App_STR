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

// hostaway-get.mjs is pinned by hash and must stay self-contained (see its
// header), so the two scripts keep their own copies of these rules. This test
// is what keeps the copies from drifting apart.
test('both Hostaway scripts share the same base-url and token-file rules', () => {
  const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
  const rules = (source) =>
    ['const LIVE_BASE_URL', 'function baseUrl()', 'function tokenFile()'].map((head) => {
      const start = source.indexOf(head);
      assert.ok(start >= 0, head);
      const end = head.startsWith('const')
        ? source.indexOf('\n', start)
        : source.indexOf('\n}\n', start) + 2;
      return source.slice(start, end);
    });
  assert.deepEqual(rules(read('hostaway-get.mjs')), rules(read('hostaway-issue-token.mjs')));
});
