import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

/**
 * Where the panel makes its Supabase clients, read off the sources.
 *
 * PostgREST is read and written only by the browser's client, the one handed
 * `staleClockSafeFetch` (packages/shared stale-clock-retry.ts). The server's client (layout,
 * settings, sign-in) and the proxy's talk to Auth alone. A new client, or a
 * table read on the server, would meet PostgREST's stale clock unprotected —
 * and a server-side retry needs more than that wrapper (see its header).
 */
const SRC = path.resolve(__dirname, '../../..');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : sources(full);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const relative = (file: string) => path.relative(SRC, file).split(path.sep).join('/');
const FILES = sources(SRC).map((file) => ({ name: relative(file), text: readFileSync(file, 'utf8') }));

const MAKES_A_CLIENT = [
  /\bcreate(?:Browser|Server)Client\s*[<(]/,
  /import\s*\{[^}]*\bcreateClient\b[^}]*\}\s*from\s*'@supabase\/supabase-js'/,
];
const READS_A_TABLE = /\.(?:from|rpc)\(\s*['"`]/;

describe('the panel’s Supabase clients', () => {
  test('are made in three places only', () => {
    const makers = FILES.filter(({ text }) => MAKES_A_CLIENT.some((pattern) => pattern.test(text)))
      .map(({ name }) => name)
      .sort();

    expect(makers).toEqual(['lib/supabase/client.ts', 'lib/supabase/server.ts', 'proxy.ts']);
  });

  test('on the server, read no table: PostgREST is read in the browser, behind the retry', () => {
    const serverSide = FILES.filter(
      ({ name, text }) =>
        name === 'proxy.ts' ||
        name === 'lib/supabase/server.ts' ||
        text.includes("from '@/lib/supabase/server'"),
    );

    expect(serverSide.map(({ name }) => name)).toContain('app/(panel)/layout.tsx');
    for (const { name, text } of serverSide) {
      expect(READS_A_TABLE.test(text), name).toBe(false);
    }
  });
});
