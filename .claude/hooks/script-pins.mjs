// PreToolUse hook for Bash and PowerShell: the no-question run of a pinned
// script is safe only while the script is the one the owner approved.
//
// scripts/cloud-read.mjs and scripts/hostaway-get.mjs run without a prompt
// (permissions.allow). Edits to them ask (permissions.ask), but a shell command
// can rewrite a file too, and no Edit rule sees that. So before such a command
// runs, this hook hashes the script it names and compares the hash with
// .claude/hooks/script-pins.json. A mismatch, or a script missing from the pins,
// turns the run into a question. A new pin is written only with the owner's
// word (the pins file is behind permissions.ask as well).

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PINNED = /scripts[\\/](cloud-read|hostaway-get)\.mjs/g;

function ask(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  let command = '';
  try {
    command = JSON.parse(input)?.tool_input?.command ?? '';
  } catch {
    process.exit(0);
  }
  const names = [...new Set([...command.matchAll(PINNED)].map((m) => `scripts/${m[1]}.mjs`))];
  if (names.length === 0) {
    process.exit(0);
  }

  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  let pins;
  try {
    pins = JSON.parse(readFileSync(join(root, '.claude', 'hooks', 'script-pins.json'), 'utf8'));
  } catch {
    ask('script-pins.json is missing or unreadable, so the pinned scripts cannot be checked');
  }

  for (const name of names) {
    let digest;
    try {
      digest = createHash('sha256').update(readFileSync(join(root, name))).digest('hex');
    } catch {
      ask(`${name} cannot be read to check its pin`);
    }
    if (pins[name] !== digest) {
      ask(`${name} differs from the version the owner approved (sha256 ${digest.slice(0, 12)}…, pinned ${String(pins[name]).slice(0, 12)}…)`);
    }
  }
  process.exit(0);
});
