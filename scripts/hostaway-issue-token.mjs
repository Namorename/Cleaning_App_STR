// Issue a Hostaway API token ONCE and store it. Run: node scripts/hostaway-issue-token.mjs
//
// Needs the owner's word every time: the permission rules ask before running
// it. Hostaway's documentation does not say whether issuing a new token revokes
// the ones already out, and the sync and the webhook processor run on tokens of
// the same account (they re-authenticate on 401, but nothing else about them is
// promised). So a token is issued once, stored, and reused by
// scripts/hostaway-get.mjs until Hostaway rejects it.
//
// Credentials (HOSTAWAY_ACCOUNT_ID, HOSTAWAY_API_KEY) come from the root .env.
// The token goes to ~/.str-ops/hostaway-token.json, outside the repository, and
// is never printed. An existing stored token is kept unless --replace is given.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const LIVE_BASE_URL = 'https://api.hostaway.com/v1';
// "The token will be valid 1 second after being returned from the API."
const TOKEN_WARMUP_MS = 1_100;

function fail(message) {
  process.stderr.write(`hostaway-issue-token: ${message}\n`);
  process.exit(1);
}

// The same rules as scripts/hostaway-get.mjs, copied rather than shared: that
// file must stay self-contained for its pin (see its header), and
// scripts/__tests__/hostaway.test.mjs keeps the two copies equal.
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

function readEnvFile() {
  const values = {};
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match) {
      values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  return values;
}

async function main() {
  const args = process.argv.slice(2);
  const replace = args.length === 1 && args[0] === '--replace';
  if (args.length > 0 && !replace) {
    fail('usage: node scripts/hostaway-issue-token.mjs [--replace]');
  }
  const file = tokenFile();
  if (existsSync(file) && !replace) {
    fail(`a token is already stored in ${file}; pass --replace to issue a new one`);
  }

  const env = readEnvFile();
  if (!env.HOSTAWAY_ACCOUNT_ID || !env.HOSTAWAY_API_KEY) {
    fail('HOSTAWAY_ACCOUNT_ID and HOSTAWAY_API_KEY must be in the root .env');
  }
  const response = await fetch(`${baseUrl()}/accessTokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.HOSTAWAY_ACCOUNT_ID,
      client_secret: env.HOSTAWAY_API_KEY,
      scope: 'general',
    }).toString(),
  });
  if (!response.ok) {
    fail(`token request refused: HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (typeof payload?.access_token !== 'string' || payload.access_token === '') {
    fail('token response has no access_token');
  }

  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({ accessToken: payload.access_token, issuedAt: new Date().toISOString() }),
    { mode: 0o600 },
  );
  await new Promise((resolve) => setTimeout(resolve, TOKEN_WARMUP_MS));
  process.stdout.write(`token issued and stored in ${file}\n`);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
