// Read-only access to the Hostaway API. Run: node scripts/hostaway-get.mjs <path> [--pick a,b] [--count]
//
// GET only. There is no method option and no token issuing here: every request
// this file makes is a GET to https://api.hostaway.com/v1/<path> with a token
// that was issued once and stored.
//
// Why stored, not issued per run (owner's word 2026-09-25): Hostaway's
// documentation says a token lives 24 months and can be revoked with
// DELETE /v1/accessTokens, and says nothing about whether issuing a new one
// revokes the ones already out. Issuing lives in scripts/hostaway-issue-token.mjs,
// a separate file the permission rules never run without the owner's word. A
// rejected token (401) stops here with a message; nothing re-issues it.
//
// The token is read from ~/.str-ops/hostaway-token.json and never printed.
//
// Self-contained on purpose: .claude/hooks/script-pins.mjs checks this file's
// hash before every no-question run, and a module it imported could change
// what runs without changing that hash. So baseUrl() and tokenFile() are
// copied in scripts/hostaway-issue-token.mjs, and
// scripts/__tests__/hostaway.test.mjs keeps the two copies equal.
//
// Personal data (guest names, phones, e-mails) is read only when a task cannot
// do without it and never goes into a report: --pick prints only the named
// fields of each result item, --count only the number of items.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const LIVE_BASE_URL = 'https://api.hostaway.com/v1';

function fail(message) {
  process.stderr.write(`hostaway-get: ${message}\n`);
  process.exit(1);
}

// Tests point the script at a local stand-in; nothing but loopback is accepted,
// so the token can never be sent anywhere but Hostaway or this machine.
function baseUrl() {
  const override = process.env.HOSTAWAY_GET_BASE_URL;
  if (!override) {
    return LIVE_BASE_URL;
  }
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(override)) {
    fail('HOSTAWAY_GET_BASE_URL may only point at loopback (tests)');
  }
  return override;
}

function tokenFile() {
  return process.env.HOSTAWAY_GET_TOKEN_FILE ?? join(homedir(), '.str-ops', 'hostaway-token.json');
}

function storedToken() {
  const file = tokenFile();
  if (!existsSync(file)) {
    fail(`no stored token (${file}); issuing one needs the owner's word: node scripts/hostaway-issue-token.mjs`);
  }
  const token = JSON.parse(readFileSync(file, 'utf8')).accessToken;
  if (typeof token !== 'string' || token === '') {
    fail(`the stored token in ${file} is malformed`);
  }
  return token;
}

/**
 * The URL a relative API path names, or null when it would leave the API root.
 *
 * No scheme, no host, no dot segment in any spelling — fetch() collapses
 * %2e%2e exactly like .. — and no backslash or encoded slash a server might
 * decode into a segment of its own. Then the URL fetch() will actually use is
 * checked to still lie under the root.
 */
export function apiUrl(base, path) {
  if (
    /^[a-z][a-z0-9+.-]*:/i.test(path) ||
    path.startsWith('/') ||
    path.includes('..') ||
    /\\|%(2e|2f|5c)/i.test(path)
  ) {
    return null;
  }
  try {
    const root = new URL(`${base}/`);
    const url = new URL(path, root);
    return url.origin === root.origin && url.pathname.startsWith(root.pathname) ? url : null;
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const [path, ...rest] = argv;
  if (!path || path.startsWith('-')) {
    fail('usage: node scripts/hostaway-get.mjs <path> [--pick a,b] [--count]');
  }
  if (apiUrl(LIVE_BASE_URL, path) === null) {
    fail('the path is relative to /v1, e.g. listings or reservations?limit=5');
  }
  const options = { path, pick: null, count: false };
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === '--pick' && rest[i + 1]) {
      options.pick = rest[i + 1].split(',').map((field) => field.trim()).filter(Boolean);
      i += 1;
    } else if (rest[i] === '--count') {
      options.count = true;
    } else {
      fail(`unknown option ${rest[i]}`);
    }
  }
  return options;
}

function project(item, fields) {
  return Object.fromEntries(fields.map((field) => [field, item?.[field] ?? null]));
}

async function get(options) {
  const url = apiUrl(baseUrl(), options.path);
  if (url === null) {
    fail('the path is relative to /v1, e.g. listings or reservations?limit=5');
  }
  const response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${storedToken()}` },
  });
  if (response.status === 401) {
    fail("Hostaway rejected the stored token (401); a new one needs the owner's word: node scripts/hostaway-issue-token.mjs");
  }
  if (!response.ok) {
    fail(`HTTP ${response.status}`);
  }
  const payload = await response.json();
  const result = payload?.result;
  if (options.count) {
    process.stdout.write(`${Array.isArray(result) ? result.length : result == null ? 0 : 1}\n`);
    return;
  }
  const shown = options.pick
    ? Array.isArray(result)
      ? result.map((item) => project(item, options.pick))
      : project(result, options.pick)
    : payload;
  process.stdout.write(`${JSON.stringify(shown, null, 2)}\n`);
}

// Run as a script only: the tests import apiUrl() and send nothing.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  get(parseArgs(process.argv.slice(2))).catch((error) =>
    fail(error instanceof Error ? error.message : String(error)),
  );
}
