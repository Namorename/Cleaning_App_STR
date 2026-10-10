// Read-only access to the Sentry API. Run:
//   node scripts/sentry-get.mjs <path> --pick a,b.c | --count | --event [frames]
//
// GET only. There is no method option: every request this file makes is a GET
// to https://de.sentry.io/api/0/<path>, redirects refused. The region is the
// one the phone's DSN names (its host is o<id>.ingest.de.sentry.io), and an EU
// organization answers only there.
//
// The token is a read-only user token the owner keeps in
// ~/.str-ops/sentry-read-token.txt, outside the repository. It is never
// printed, logged or written anywhere; only the Authorization header carries it.
//
// {org}, {project} and {projectId} in the path are filled in at run time from
// the only organization and project the token can see (the EAS variables
// SENTRY_ORG and SENTRY_PROJECT name the same pair). The two slugs are looked
// up on every run and printed back as the placeholders wherever a response
// carries them, in any case: the reports never carry them.
//
// Nothing is printed whole. --count prints the number of items; --event a
// summary of one event (release tags, exception, the top frames of each stack)
// without the user, the breadcrumbs, the request or the device; --pick exactly
// the (dotted) fields it is given — asking it for `user`, `tags`, `entries`,
// `request` or `contexts` prints what those hold, personal data included, so
// such a pick is for a local filter, never for a report.
//
// Self-contained on purpose, like scripts/hostaway-get.mjs: a pinned hash of
// this file must describe everything it runs. apiUrl() is a copy of that
// file's; scripts/__tests__/sentry-get.test.mjs keeps the two equal.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const LIVE_BASE_URL = 'https://de.sentry.io/api/0';
const DEFAULT_FRAMES = 8;
const REQUEST_TIMEOUT_MS = 30_000;
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

/**
 * The text with every resolved slug turned back into its placeholder: in any
 * case (Sentry's short ids are the project slug in capitals), wherever no
 * letter or digit touches it (so `acme_prod` and `ACME-12` give it up too),
 * the longer slug first (a project named after its organization).
 */
export function redact(text, names) {
  const slugs = [
    ['project', names.project],
    ['org', names.org],
  ]
    .filter(([, value]) => typeof value === 'string' && value.length > 0)
    .sort((a, b) => b[1].length - a[1].length);
  return slugs.reduce(
    (out, [key, value]) =>
      out.replace(
        new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(value)}(?![A-Za-z0-9])`, 'gi'),
        `{${key}}`,
      ),
    text,
  );
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
 * of the stack (Sentry lists frames oldest first, so the top is the end). The
 * title and the exception's message are the app's own text: read them before
 * quoting them.
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

const USAGE = 'usage: node scripts/sentry-get.mjs <path> --pick a,b.c | --count | --event [frames]';

/** The path and the one way to print it; anything else is refused. */
export function parseArgs(argv) {
  const [path, ...rest] = argv;
  if (!path || path.startsWith('-')) {
    return { error: USAGE };
  }
  const modes = [];
  let pick = null;
  let frames = DEFAULT_FRAMES;
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--pick' && rest[i + 1]) {
      pick = rest[i + 1].split(',').map((field) => field.trim()).filter(Boolean);
      modes.push('pick');
      i += 1;
    } else if (arg === '--count') {
      modes.push('count');
    } else if (arg === '--event') {
      modes.push('event');
      const next = Number(rest[i + 1]);
      const isFrames = rest[i + 1] !== undefined && Number.isInteger(next) && next > 0;
      if (isFrames) {
        frames = next;
        i += 1;
      }
    } else {
      return { error: `unknown option ${arg}` };
    }
  }
  if (modes.length !== 1) {
    return { error: `give exactly one of --pick, --count or --event (${USAGE})` };
  }
  if (apiUrl(LIVE_BASE_URL, fillPath(path, { org: 'o', project: 'p', projectId: '1' })) === null) {
    return { error: 'the path is relative to /api/0, e.g. organizations/{org}/issues/?limit=5' };
  }
  return { path, mode: modes[0], pick, frames };
}

async function getJson(base, token, path) {
  const url = apiUrl(base, path);
  if (url === null) {
    fail('the path is relative to /api/0, e.g. organizations/{org}/issues/?limit=5');
  }
  const response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'error',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
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

/** The one item of a list, or null; a path that needs it fails instead. */
function theOnly(items, what, isNeeded) {
  if (Array.isArray(items) && items.length === 1) {
    return items[0];
  }
  const seen = Array.isArray(items) ? items.length : 0;
  if (isNeeded) {
    fail(`the token sees ${seen} ${what}; exactly one is expected`);
  }
  process.stderr.write(`sentry-get: the token sees ${seen} ${what}; their slugs are not redacted\n`);
  return null;
}

// Looked up on every run, placeholders or not: the slugs are what the output
// must never carry, and only a run that knows them can take them out.
async function resolveNames(base, token, path) {
  const needsOrg = /\{(org|project|projectId)\}/.test(path);
  const needsProject = /\{(project|projectId)\}/.test(path);
  const org = theOnly(await getJson(base, token, 'organizations/'), 'organizations', needsOrg);
  if (org === null) {
    return {};
  }
  const projects = await getJson(base, token, `organizations/${org.slug}/projects/`);
  const project = theOnly(projects, 'projects', needsProject);
  return project === null
    ? { org: org.slug }
    : { org: org.slug, project: project.slug, projectId: String(project.id) };
}

function shown(result, options) {
  if (options.mode === 'count') {
    return Array.isArray(result) ? result.length : result == null ? 0 : 1;
  }
  if (options.mode === 'event') {
    return eventSummary(result, options.frames);
  }
  return pickFields(result, options.pick);
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.error) {
    fail(options.error);
  }
  const base = baseUrl();
  const token = storedToken();
  const names = await resolveNames(base, token, options.path);
  const result = await getJson(base, token, fillPath(options.path, names));
  process.stdout.write(`${redact(JSON.stringify(shown(result, options), null, 2), names)}\n`);
}

// Run as a script only: the tests import the helpers and send nothing.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((error) =>
    fail(error instanceof Error ? error.message : String(error)),
  );
}
