/**
 * The knowledge base's text format, read the same way by the panel's preview
 * and by the phone (docs/knowledge-base-step1.md, «Разметка»).
 *
 * A small set on purpose, and never HTML: the result is data — blocks of
 * lines of pieces — that each app draws with its own elements, so nothing a
 * manager types is ever handed to a browser or a WebView as markup. What is
 * not one of the forms below stays the text it was.
 *
 * - a blank line ends a block; a single line break stays inside it;
 * - `- ` or `* ` starts a bullet, `1. ` a numbered item, `1) ` a step — one
 *   to three digits, counted on from the first one written;
 * - `> ` starts a line of an important note;
 * - `**bold**` inside a line, opening and closing on a non-space;
 * - `[text](https://…)`, and a bare `https://…` address — https only, checked
 *   by `isSafeHttpsUrl`; parentheses inside an address are kept in pairs.
 *
 * Every scan is bounded: a mark whose pair is far away, or never comes, does
 * not send the reader back over the rest of the line, and an address is never
 * looked for past its longest allowed length.
 *
 * No regular expression here needs more than ES2018 without look-behind:
 * Hermes reads this file on the phone.
 */

export type KbInline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'bold'; readonly text: string }
  | { readonly kind: 'link'; readonly text: string; readonly href: string };

export type KbLine = readonly KbInline[];

export type KbBlock =
  | { readonly kind: 'paragraph'; readonly lines: readonly KbLine[] }
  | { readonly kind: 'bullets'; readonly items: readonly KbLine[] }
  | { readonly kind: 'numbered'; readonly start: number; readonly items: readonly KbLine[] }
  | { readonly kind: 'steps'; readonly start: number; readonly items: readonly KbLine[] }
  | { readonly kind: 'important'; readonly lines: readonly KbLine[] };

/** What the editor's buttons insert: the same marks this reader takes. */
export const KB_MARKS = {
  bold: '**',
  bullet: '- ',
  numbered: '1. ',
  step: '1) ',
  important: '> ',
} as const;

/** The longest address taken as a link. */
export const KB_URL_MAX_LENGTH = 2048;

const HTTPS = 'https://';
/**
 * Never in an address: spaces and control characters, the characters HTML and
 * shells give a meaning to, and the invisible, bidirectional and full-width
 * ones a host could hide behind (U+202E would turn the domain shown around).
 */
const UNSAFE_IN_URL =
  /[\s\u0000-\u001f\u007f<>"`\\{}|^­؜᠎ -⁯　-〿﻿＀-￯]/;
const HOST_LABEL = /^[a-z0-9¡-￿]([a-z0-9¡-￿-]*[a-z0-9¡-￿])?$/;
const PORT = /^\d{1,5}$/;
const MAX_PORT = 65535;

/**
 * An address the apps may open: https, a host with a dot, no user or password
 * before it, no spaces, control or invisible characters, at most 2048
 * characters. One rule for both apps; the phone has no full `URL`, so it is
 * read by hand.
 */
export function isSafeHttpsUrl(candidate: string): boolean {
  if (candidate.length > KB_URL_MAX_LENGTH || UNSAFE_IN_URL.test(candidate)) {
    return false;
  }
  if (candidate.slice(0, HTTPS.length).toLowerCase() !== HTTPS) {
    return false;
  }
  const rest = candidate.slice(HTTPS.length);
  const authorityEnd = rest.search(/[/?#]/);
  const authority = authorityEnd === -1 ? rest : rest.slice(0, authorityEnd);
  if (authority.includes('@')) {
    return false;
  }
  const [host, port, ...extra] = authority.split(':');
  if (extra.length > 0 || (port !== undefined && (!PORT.test(port) || Number(port) > MAX_PORT))) {
    return false;
  }
  const labels = host.toLowerCase().split('.');
  return labels.length > 1 && labels.every((label) => HOST_LABEL.test(label));
}

type LineKind = 'paragraph' | 'bullets' | 'numbered' | 'steps' | 'important';

interface ClassifiedLine {
  kind: LineKind;
  /** For a numbered item or a step: the number written. */
  number: number;
  text: string;
}

// [\s\S], not a dot: a line may hold U+2028 or U+2029, which a dot does not match.
const BULLET = /^[-*] +([\s\S]*)$/;
const NUMBERED = /^(\d{1,3})\. +([\s\S]*)$/;
const STEP = /^(\d{1,3})\) +([\s\S]*)$/;
const IMPORTANT = /^> ?([\s\S]*)$/;
const INDENT = /^[ \t]{0,3}/;

function classify(raw: string): ClassifiedLine {
  const line = raw.replace(INDENT, '');
  const bullet = BULLET.exec(line);
  if (bullet !== null) {
    return { kind: 'bullets', number: 0, text: bullet[1] };
  }
  const numbered = NUMBERED.exec(line);
  if (numbered !== null) {
    return { kind: 'numbered', number: Number(numbered[1]), text: numbered[2] };
  }
  const step = STEP.exec(line);
  if (step !== null) {
    return { kind: 'steps', number: Number(step[1]), text: step[2] };
  }
  const important = IMPORTANT.exec(line);
  if (important !== null) {
    return { kind: 'important', number: 0, text: important[1] };
  }
  return { kind: 'paragraph', number: 0, text: raw };
}

const isSpace = (char: string | undefined): boolean => char === undefined || /\s/.test(char);
const isWordChar = (char: string | undefined): boolean =>
  char !== undefined && /[0-9A-Za-zÀ-￿]/.test(char);

/** Characters that end a sentence rather than an address; `)` only when unpaired. */
const TRAILING_PUNCTUATION = '.,;:!?]}\'"';
const URL_STOP = /[\s<>"`]/;

function count(text: string, char: string): number {
  let found = 0;
  for (const one of text) {
    if (one === char) {
      found += 1;
    }
  }
  return found;
}

/**
 * Where the next `needle` is at or after `from`, remembered: the reader moves
 * forward only, so a closer found once serves every opener before it, and a
 * closer never found is not looked for again.
 */
function forwardFinder(line: string, needle: string): (from: number) => number {
  let found = -2;
  return (from) => {
    if (found === -1 || found >= from) {
      return found;
    }
    found = line.indexOf(needle, from);
    return found;
  };
}

/**
 * The address of `[text](…)` opening at `start`, up to its closing bracket —
 * parentheses inside it kept in pairs — or null. Looks no further than the
 * longest address allowed, and stops at a space.
 */
function bracketedAddress(line: string, start: number): { href: string; end: number } | null {
  const limit = Math.min(line.length, start + KB_URL_MAX_LENGTH + 1);
  let depth = 0;
  for (let at = start; at < limit; at += 1) {
    const char = line[at];
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      if (depth === 0) {
        return { href: line.slice(start, at), end: at + 1 };
      }
      depth -= 1;
    } else if (isSpace(char)) {
      return null;
    }
  }
  return null;
}

/** An https address starting at `at`, without the punctuation that follows it. */
function bareAddressAt(line: string, at: number): string | null {
  if (line.slice(at, at + HTTPS.length).toLowerCase() !== HTTPS) {
    return null;
  }
  const limit = Math.min(line.length, at + KB_URL_MAX_LENGTH + 1);
  let end = at + HTTPS.length;
  while (end < limit && !URL_STOP.test(line[end])) {
    end += 1;
  }
  if (end - at > KB_URL_MAX_LENGTH) {
    return null;
  }
  while (end > at + HTTPS.length) {
    const last = line[end - 1];
    const isUnpairedClose =
      last === ')' && count(line.slice(at, end), '(') < count(line.slice(at, end), ')');
    if (!isUnpairedClose && !TRAILING_PUNCTUATION.includes(last)) {
      break;
    }
    end -= 1;
  }
  const href = line.slice(at, end);
  return isSafeHttpsUrl(href) ? href : null;
}

function readLine(line: string): KbInline[] {
  const pieces: KbInline[] = [];
  const nextStars = forwardFinder(line, '**');
  const nextBracket = forwardFinder(line, ']');
  let plain = '';
  let at = 0;

  const emit = (piece: KbInline, end: number) => {
    if (plain !== '') {
      pieces.push({ kind: 'text', text: plain });
      plain = '';
    }
    pieces.push(piece);
    at = end;
  };

  while (at < line.length) {
    const char = line[at];

    if (char === '[') {
      const close = nextBracket(at + 1);
      const label = close === -1 ? '' : line.slice(at + 1, close);
      if (close !== -1 && line[close + 1] === '(' && label.trim() !== '' && !label.includes('[')) {
        const address = bracketedAddress(line, close + 2);
        if (address !== null && isSafeHttpsUrl(address.href)) {
          emit({ kind: 'link', text: label, href: address.href }, address.end);
          continue;
        }
      }
    } else if (char === '*' && line[at + 1] === '*' && !isSpace(line[at + 2])) {
      const close = nextStars(at + 3);
      if (close !== -1 && !isSpace(line[close - 1])) {
        emit({ kind: 'bold', text: line.slice(at + 2, close) }, close + 2);
        continue;
      }
    } else if ((char === 'h' || char === 'H') && !isWordChar(line[at - 1])) {
      const href = bareAddressAt(line, at);
      if (href !== null) {
        emit({ kind: 'link', text: href, href }, at + href.length);
        continue;
      }
    }

    plain += char;
    at += 1;
  }

  if (plain !== '') {
    pieces.push({ kind: 'text', text: plain });
  }
  return pieces;
}

/** The text as blocks to draw. Never throws: what is not markup is text. */
export function parseKbMarkup(source: string): KbBlock[] {
  const blocks: KbBlock[] = [];
  let kind: LineKind | null = null;
  let start = 0;
  let lines: KbLine[] = [];

  const close = () => {
    if (kind === null) {
      return;
    }
    if (kind === 'paragraph' || kind === 'important') {
      blocks.push({ kind, lines });
    } else if (kind === 'bullets') {
      blocks.push({ kind, items: lines });
    } else {
      blocks.push({ kind, start, items: lines });
    }
    kind = null;
    lines = [];
  };

  for (const raw of source.replace(/\r\n?/g, '\n').split('\n')) {
    // trimEnd, not a regular expression: /\s+$/ backtracks over a long run of spaces.
    const trimmed = raw.trimEnd();
    if (trimmed === '') {
      close();
      continue;
    }
    const line = classify(trimmed);
    if (line.kind !== kind) {
      close();
      kind = line.kind;
      start = line.number;
    }
    lines.push(readLine(line.text));
  }
  close();

  return blocks;
}
