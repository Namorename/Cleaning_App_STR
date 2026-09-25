// Read-only query against the cloud database. Run: node scripts/cloud-read.mjs <file.sql>
//                                          or: node scripts/cloud-read.mjs --sql "<query>"
//
// The boundary is the database, not this file. The query goes to the Management
// API endpoint POST /v1/projects/{ref}/database/query/read-only, which runs it
// as supabase_read_only_user: a role with pg_read_all_data and no write
// privilege on any table, in a read-only transaction. An INSERT, UPDATE or
// DELETE on application data is refused by Postgres whatever the SQL says; the
// few side effects the role could still reach are refused below (refusal).
// Writes to the cloud go through `supabase db query --linked` / `db push`,
// which ask the owner.
//
// The access token is the one the Supabase CLI logged in with: SUPABASE_ACCESS_TOKEN
// if set (the CLI reads it first too), else the CLI's entry in the Windows
// Credential Manager ("Supabase CLI:supabase"). It is held in memory for the
// request and never printed or written anywhere.
//
// Rows are printed as JSON. Personal data (guest names, e-mails, phones, note
// texts) is read only when a task cannot do without it and never goes into a
// report — ask for counts.

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const API_BASE = 'https://api.supabase.com/v1';
const PROJECT_REF_FILE = 'supabase/.temp/project-ref';
const CREDENTIAL_TARGET = 'Supabase CLI:supabase';

function fail(message) {
  process.stderr.write(`cloud-read: ${message}\n`);
  process.exit(1);
}

function readQuery(argv) {
  if (argv[0] === '--sql' && typeof argv[1] === 'string' && argv.length === 2) {
    return argv[1];
  }
  if (argv.length === 1 && !argv[0].startsWith('-')) {
    return readFileSync(argv[0], 'utf8');
  }
  fail('usage: node scripts/cloud-read.mjs <file.sql> | --sql "<query>"');
}

// A second layer, not the boundary. Checked 2026-09-25: the endpoint runs the
// query as supabase_read_only_user in a read-only transaction; every INSERT,
// UPDATE, DELETE and data-modifying CTE is refused, and the only definer
// functions the role may call only read (auth_role, is_active_user,
// is_manager). But the endpoint takes several statements, so `set transaction
// read write` can lift the read-only mode, and PUBLIC may still execute a few
// extension functions written in C: cron.schedule/unschedule (a job owned by
// the read-only role — it could only read, but the row in cron.job is a
// write), net.worker_restart/wake, and the large-object functions. Until F13
// revokes those in the database, this check is what stops them.
//
// So it reads the query the way the server will (lexQuery): comments go,
// string literals are set aside, quoted identifiers lose their quotes — a
// comment marker inside a string, "cron"."schedule" or a comment between the
// names changes nothing. Then it fails closed:
//   - every statement must be a read (READ_STATEMENT): no SET, DO, PREPARE or
//     transaction control, so no search_path trick and no dynamic SQL;
//   - the side-effect functions are refused by bare name, whatever schema or
//     search_path would resolve them, and so are the functions that run SQL
//     handed to them as a string (REFUSED_CALLS);
//   - set_config may only set the JWT claims a probe acts under;
//   - a query the lexer cannot read to the end (an unterminated literal or
//     comment, a U& escape) is refused rather than guessed at.
const READ_STATEMENT = /^(select|with|explain|show|table|values|\()/;
const REFUSED_CALLS = [
  [/\b(schedule|schedule_in_database|unschedule|alter_job)\s*\(/, 'scheduling cron jobs'],
  [/\bnet\s*\.|\b(http|http_\w+|worker_restart|wake|wait_until_running)\s*\(/, 'calling pg_net or http'],
  [/\blo_\w+\s*\(|\blo(read|write)\s*\(/, 'large objects'],
  [/\bdblink\w*\s*\(/, 'dblink'],
  [/\b(query_to_xml\w*|cursor_to_xml\w*|ts_stat|ts_rewrite)\s*\(/, 'running SQL handed over as a string'],
  [/\bpg_notify\s*\(/, 'notifications'],
];
const SET_CONFIG = /\bset_config\s*\(/g;
const SET_CONFIG_LITERAL = /\bset_config\s*\(\s*'#(\d+)'/g;
const CLAIMS_SETTING = /^request\.jwt\.claims?(\.|$)/;

const WORD_CHAR = /[\p{L}\p{N}_$]/u;
const DOLLAR_TAG = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/;

// Index just past the closing quote, or -1. A doubled quote belongs to the
// text; in an E'' string so does a backslash-escaped character.
function quotedEnd(query, start, quote, backslashEscapes) {
  let i = start + 1;
  while (i < query.length) {
    if (backslashEscapes && query[i] === '\\') {
      i += 2;
    } else if (query[i] === quote && query[i + 1] === quote) {
      i += 2;
    } else if (query[i] === quote) {
      return i + 1;
    } else {
      i += 1;
    }
  }
  return -1;
}

// Index just past the comment that opens at start (they nest), or -1.
function blockCommentEnd(query, start) {
  let depth = 0;
  let i = start;
  while (i < query.length) {
    if (query.startsWith('/*', i)) {
      depth += 1;
      i += 2;
    } else if (query.startsWith('*/', i)) {
      depth -= 1;
      i += 2;
      if (depth === 0) {
        return i;
      }
    } else {
      i += 1;
    }
  }
  return -1;
}

// The query as the server parses it: lower-cased code with comments dropped,
// quoted identifiers unquoted and each literal replaced by '#n', plus the
// literals themselves. Null when the query cannot be read to the end.
function lexQuery(query) {
  const literals = [];
  let code = '';
  let i = 0;
  const wordCharAt = (at) => at >= 0 && WORD_CHAR.test(query[at]);
  const setAside = (text) => {
    code += `'#${literals.length}'`;
    literals.push(text);
  };
  while (i < query.length) {
    const ch = query[i];
    if (query.startsWith('--', i)) {
      const end = query.indexOf('\n', i);
      i = end === -1 ? query.length : end;
      code += ' ';
    } else if (query.startsWith('/*', i)) {
      const end = blockCommentEnd(query, i);
      if (end === -1) {
        return null;
      }
      i = end;
      code += ' ';
    } else if ((ch === 'u' || ch === 'U') && query[i + 1] === '&' && !wordCharAt(i - 1)) {
      return null;
    } else if (ch === "'") {
      const escaped = (query[i - 1] === 'e' || query[i - 1] === 'E') && !wordCharAt(i - 2);
      const end = quotedEnd(query, i, "'", escaped);
      if (end === -1) {
        return null;
      }
      setAside(query.slice(i + 1, end - 1).replaceAll("''", "'"));
      i = end;
    } else if (ch === '"') {
      const end = quotedEnd(query, i, '"', false);
      if (end === -1) {
        return null;
      }
      code += query.slice(i + 1, end - 1).replaceAll('""', '"');
      i = end;
    } else if (ch === '$' && !wordCharAt(i - 1) && DOLLAR_TAG.test(query.slice(i))) {
      const tag = query.slice(i).match(DOLLAR_TAG)[0];
      const close = query.indexOf(tag, i + tag.length);
      if (close === -1) {
        return null;
      }
      setAside(query.slice(i + tag.length, close));
      i = close + tag.length;
    } else {
      code += ch;
      i += 1;
    }
  }
  return { code: code.toLowerCase(), literals };
}

/** Why the query is not a plain read, or null when it is. */
export function refusal(query) {
  const lexed = lexQuery(query);
  if (lexed === null) {
    return 'a literal, comment or escape the check cannot read to the end';
  }
  const { code, literals } = lexed;
  const statements = code.split(';').map((part) => part.trim()).filter((part) => part !== '');
  const notARead = statements.find((statement) => !READ_STATEMENT.test(statement));
  if (notARead !== undefined) {
    return `a statement that is not a read (${notARead.split(/\s+/)[0]} …)`;
  }
  for (const [pattern, what] of REFUSED_CALLS) {
    if (pattern.test(code)) {
      return what;
    }
  }
  const claims = [...code.matchAll(SET_CONFIG_LITERAL)].filter((match) =>
    CLAIMS_SETTING.test(literals[Number(match[1])]),
  );
  if ((code.match(SET_CONFIG) ?? []).length !== claims.length) {
    return 'set_config of anything but request.jwt.claims';
  }
  return null;
}

function refuseSideEffects(query) {
  const reason = refusal(query);
  if (reason !== null) {
    fail(`refused, not a read: ${reason} (scripts/cloud-read.mjs, refusal)`);
  }
  return query;
}

function projectRef() {
  const ref = readFileSync(PROJECT_REF_FILE, 'utf8').trim();
  if (!/^[a-z0-9]{20}$/.test(ref)) {
    fail(`unexpected project ref in ${PROJECT_REF_FILE}`);
  }
  return ref;
}

// The CLI keeps its token through go-keyring: on Windows a generic credential
// whose blob is the token's bytes. Read with CredRead, never displayed.
const CRED_READ_PS = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class W3CredRead {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct CREDENTIAL {
    public int Flags; public int Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
    public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CredRead(string target, int type, int flags, out IntPtr credential);
  [DllImport("advapi32.dll")]
  static extern void CredFree(IntPtr credential);
  public static string Read(string target) {
    IntPtr p;
    if (!CredRead(target, 1, 0, out p)) { return ""; }
    try {
      var c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
      var bytes = new byte[c.CredentialBlobSize];
      Marshal.Copy(c.CredentialBlob, bytes, 0, c.CredentialBlobSize);
      return Convert.ToBase64String(bytes);
    } finally { CredFree(p); }
  }
}
'@
[W3CredRead]::Read('${CREDENTIAL_TARGET}')
`;

function decodeBlob(base64) {
  const bytes = Buffer.from(base64, 'base64');
  // A UTF-16 blob has a zero byte after every ASCII character.
  const text = bytes.includes(0) ? bytes.toString('utf16le') : bytes.toString('utf8');
  const trimmed = text.trim();
  const prefix = 'go-keyring-base64:';
  return trimmed.startsWith(prefix)
    ? Buffer.from(trimmed.slice(prefix.length), 'base64').toString('utf8').trim()
    : trimmed;
}

function accessToken() {
  const fromEnv = process.env.SUPABASE_ACCESS_TOKEN;
  if (fromEnv) {
    return fromEnv.trim();
  }
  if (process.platform !== 'win32') {
    fail('set SUPABASE_ACCESS_TOKEN: the credential-store fallback is Windows only');
  }
  const res = spawnSync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', CRED_READ_PS],
    { encoding: 'utf8' },
  );
  const blob = (res.stdout ?? '').trim();
  if (res.status !== 0 || blob === '') {
    fail(`no CLI token in the credential store ("${CREDENTIAL_TARGET}"): run npx supabase login`);
  }
  const token = decodeBlob(blob);
  if (!/^sbp_[A-Za-z0-9_]+$/.test(token)) {
    fail('the stored CLI credential is not a personal access token (sbp_...)');
  }
  return token;
}

async function main() {
  const query = refuseSideEffects(readQuery(process.argv.slice(2)));
  const response = await fetch(`${API_BASE}/projects/${projectRef()}/database/query/read-only`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  const text = await response.text();
  if (!response.ok) {
    fail(`HTTP ${response.status}: ${text.slice(0, 2000)}`);
  }
  process.stdout.write(`${text}\n`);
}

// Run as a script only: the tests import refusal() and send nothing.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
}
