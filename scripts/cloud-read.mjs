// Read-only query against the cloud database. Run: node scripts/cloud-read.mjs <file.sql>
//                                          or: node scripts/cloud-read.mjs --sql "<query>"
//
// The boundary is the database, not this file. The query goes to the Management
// API endpoint POST /v1/projects/{ref}/database/query/read-only, which runs it
// as supabase_read_only_user: a role with pg_read_all_data and no write
// privilege on any table, in a read-only transaction. An INSERT, UPDATE or
// DELETE on application data is refused by Postgres whatever the SQL says; the
// few side effects the role could still reach are refused below (REFUSED).
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
// write), net.worker_restart/wake, and the large-object functions. Those are
// refused here before the query leaves the machine.
const REFUSED = [
  [/(^|;)\s*(begin|start\s+transaction|commit|end|rollback|abort|savepoint|release|prepare\s+transaction)\b/i, 'transaction control'],
  [/\bset\s+(session\s+characteristics|(local\s+|session\s+)?transaction)\b/i, 'changing the transaction mode'],
  [/\bcron\s*\.\s*(schedule|schedule_in_database|unschedule|alter_job)\s*\(/i, 'scheduling cron jobs'],
  [/\bnet\s*\.\s*\w+\s*\(/i, 'calling pg_net'],
  [/\blo_\w+\s*\(/i, 'large objects'],
  [/\bdblink\w*\s*\(/i, 'dblink'],
];

function refuseSideEffects(query) {
  const withoutComments = query.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
  for (const [pattern, what] of REFUSED) {
    if (pattern.test(withoutComments)) {
      fail(`refused: ${what} is not a read (scripts/cloud-read.mjs, REFUSED)`);
    }
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

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
