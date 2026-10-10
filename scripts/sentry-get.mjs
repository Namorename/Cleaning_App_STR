// Read-only access to the Sentry API. Run:
//   node scripts/sentry-get.mjs <path> --pick a,b.c | --count | --event [frames]
//
// GET only. There is no method option: every request this file makes is a GET
// to https://de.sentry.io/api/0/<path>. The region is the one the phone's DSN
// names (its host is o<id>.ingest.de.sentry.io), and an EU organization answers
// only there.
//
// The token is a read-only user token the owner keeps in
// ~/.str-ops/sentry-read-token.txt, outside the repository. It is never
// printed, logged or written anywhere; only the Authorization header carries it.
//
// {org}, {project} and {projectId} in the path are filled in at run time from
// the only organization and project the token can see (the EAS variables
// SENTRY_ORG and SENTRY_PROJECT name the same pair), and every place the slugs
// appear in a response is printed back as the placeholder: the reports never
// carry them.
//
// Nothing is printed raw. --pick prints the named (dotted) fields of each
// item, --count the number of items, --event a summary of one event (release
// tags, exception, the top frames of each stack) without the user, the
// breadcrumbs, the request or the device: those can carry personal data.
//
// Self-contained on purpose, like scripts/hostaway-get.mjs: a pinned hash of
// this file must describe everything it runs.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const LIVE_BASE_URL = 'https://de.sentry.io/api/0';
const DEFAULT_FRAMES = 8;
const EVENT_TAGS = ['release', 'dist', 'environment', 'level', 'handled', 'mechanism', 'os', 'os.name'];

function fail(message) {
  process.stderr.write(`sentry-get: ${message}\n`);
  process.exit(1);
}

// Tests point the script at a local stand-in; nothing but loopback is accepted,
// so the token can never be sent anywhere but Sentry or this machine.
function baseUrl() {
  const override = process.env.SENTRY_GET_BASE_URL;
  if (!override) {
    return LIVE_BASE_URL;
  }
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(override)) {
    fail('SENTRY_GET_BASE_URL may only point at loopback (tests)');
  }
  return override;
}

function tokenFile() {
  return process.env.SENTRY_GET_TOKEN_FILE ?? join(homedir(), '.str-ops', 'sentry-read-token.txt');
}

function storedToken() {
  const file = tokenFile();
  if (!existsSync(file)) {
    fail(`no token file (${file}); the owner puts a read-only Sentry token there`);
  }
  const token = readFileSync(file, 'utf8').trim();
  if (!/^[A-Za-z0-9_.=-]{20,}$/.test(token)) {
    fail(`the token in ${file} is malformed`);
  }
  return token;
}

/**
 * The URL a relative API path names, or null when it would leave the API root.
 * The same rules as scripts/hostaway-get.mjs: no scheme, no host, no dot
 * segment in any spelling, no backslash or encoded slash, and the URL fetch()
 * will use must still lie under the root.
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

/** The path with {org}, {project} and {projectId} put in. */
export function fillPath(path, names) {
  return path
    .replaceAll('{org}', names.org ?? '{org}')
    .replaceAll('{projectId}', names.projectId ?? '{projectId}')
    .replaceAll('{project}', names.project ?? '{project}');
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The text with every resolved slug turned back into its placeholder. */
export function redact(text, names) {
  let out = text;
  for (const [key, value] of [
    ['org', names.org],
    ['project', names.project],
  ]) {
    if (typeof value === 'string' && value.length > 0) {
      out = out.replace(new RegExp(`\\b${escapeRegExp(value)}\\b`, 'g'), `{${key}}`);
    }
  }
  return out;
}

function readPath(item, dotted) {
  return dotted.split('.').reduce((value, key) => (value == null ? undefined : value[key]), item);
}

/** The named (dotted) fields of each item, or of the one object. */
export function pickFields(result, fields) {
  const project = (item) => Object.fromEntries(fields.map((field) => [field, readPath(item, field) ?? null]));
  return Array.isArray(result) ? result.map(project) : project(result);
}

function frameOf(frame) {
  return {
    filename: frame.filename ?? frame.absPath ?? null,
    function: frame.function ?? null,
    line: frame.lineNo ?? null,
    column: frame.colNo ?? null,
    inApp: frame.inApp ?? null,
  };
}

/**
 * One event without the person: its id and time, the release tags, and for
 * each exception the type, the message, how it was caught and the top frames
 * of the stack (Sentry lists frames oldest first, so the top is the end).
 */
export function eventSummary(event, frames = DEFAULT_FRAMES) {
  const tags = Object.fromEntries(
    (event.tags ?? []).filter((tag) => EVENT_TAGS.includes(tag.key)).map((tag) => [tag.key, tag.value]),
  );
  const exceptionEntry = (event.entries ?? []).find((entry) => entry.type === 'exception');
  const exceptions = (exceptionEntry?.data?.values ?? []).map((value) => ({
    type: value.type ?? null,
    value: value.value ?? null,
    mechanism: value.mechanism?.type ?? null,
    handled: value.mechanism?.handled ?? null,
    frames: (value.stacktrace?.frames ?? []).slice(-frames).reverse().map(frameOf),
  }));
  return {
    eventID: event.eventID ?? event.id ?? null,
    dateCreated: event.dateCreated ?? null,
    title: event.title ?? null,
    platform: event.platform ?? null,
    tags,
    exceptions,
  };
}

function parseArgs(argv) {
  const usage = 'usage: node scripts/sentry-get.mjs <path> --pick a,b.c | --count | --event [frames]';
  const [path, ...rest] = argv;
  if (!path || path.startsWith('-')) {
    fail(usage);
  }
  const options = { path, pick: null, count: false, event: null };
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === '--pick' && rest[i + 1]) {
      options.pick = rest[i + 1].split(',').map((field) => field.trim()).filter(Boolean);
      i += 1;
    } else if (rest[i] === '--count') {
      options.count = true;
    } else if (rest[i] === '--event') {
      const frames = Number(rest[i + 1]);
      options.event = Number.isInteger(frames) && frames > 0 ? frames : DEFAULT_FRAMES;
      if (options.event === frames) {
        i += 1;
      }
    } else {
      fail(`unknown option ${rest[i]}`);
    }
  }
  if (!options.pick && !options.count && !options.event) {
    fail(`nothing is printed raw; give --pick, --count or --event (${usage})`);
  }
  if (apiUrl(LIVE_BASE_URL, fillPath(path, { org: 'o', project: 'p', projectId: '1' })) === null) {
    fail('the path is relative to /api/0, e.g. organizations/{org}/issues/?limit=5');
  }
  return options;
}

async function getJson(base, token, path) {
  const url = apiUrl(base, path);
  if (url === null) {
    fail('the path is relative to /api/0, e.g. organizations/{org}/issues/?limit=5');
  }
  const response = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
  if (response.status === 401 || response.status === 403) {
    fail(`Sentry refused the stored token (${response.status}); it needs org:read, project:read and event:read`);
  }
  if (!response.ok) {
    fail(`HTTP ${response.status}`);
  }
  const link = response.headers.get('link') ?? '';
  if (/rel="next"; results="true"/.test(link)) {
    process.stderr.write('sentry-get: more results on the next page (cursor not followed)\n');
  }
  return response.json();
}

function onlyOne(items, what) {
  if (!Array.isArray(items) || items.length !== 1) {
    fail(`the token sees ${Array.isArray(items) ? items.length : 0} ${what}; exactly one is expected`);
  }
  return items[0];
}

async function resolveNames(base, token, path) {
  const names = {};
  if (!/\{(org|project|projectId)\}/.test(path)) {
    return names;
  }
  names.org = onlyOne(await getJson(base, token, 'organizations/'), 'organizations').slug;
  if (/\{(project|projectId)\}/.test(path)) {
    const project = onlyOne(await getJson(base, token, `organizations/${names.org}/projects/`), 'projects');
    names.project = project.slug;
    names.projectId = String(project.id);
  }
  return names;
}

async function main(options) {
  const base = baseUrl();
  const token = storedToken();
  const names = await resolveNames(base, token, options.path);
  const result = await getJson(base, token, fillPath(options.path, names));
  const shown = options.count
    ? Array.isArray(result)
      ? result.length
      : result == null
        ? 0
        : 1
    : options.event
      ? eventSummary(result, options.event)
      : pickFields(result, options.pick);
  process.stdout.write(`${redact(JSON.stringify(shown, null, 2), names)}\n`);
}

// Run as a script only: the tests import the helpers and send nothing.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(parseArgs(process.argv.slice(2))).catch((error) =>
    fail(error instanceof Error ? error.message : String(error)),
  );
}
