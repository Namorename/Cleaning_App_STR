/**
 * Names and contacts out of a guest's text, in memory, before the text goes
 * anywhere — to the database or to the model (docs/reviews-to-tasks.md
 * §3.2). The same redacted text is what is stored.
 *
 * - the guest's names from the PMS → [GUEST], the company's people → [STAFF],
 *   the place's names → [PROPERTY];
 * - e-mail, links, @handles, phone numbers → [EMAIL], [URL], [NAME], [PHONE];
 * - four digits or more in a row (door codes!) → [NUMBER];
 * - a capitalised word after a greeting or a thank-you → [NAME].
 *
 * A person's name is matched as written with a capital (or in capitals) and
 * as a whole word, never inside another word or in lower case: "Will" the
 * cleaner must not take "we will come back" with him.
 */

export interface RedactionNames {
  /** The guest's names as the PMS gives them, whole ("Anna Nováková"). */
  readonly guest: readonly string[];
  /** The company's people (profiles.full_name). */
  readonly staff: readonly string[];
  /** The place's names: the PMS's listing names and ours. */
  readonly places: readonly string[];
}

export const PLACEHOLDERS = [
  "[GUEST]",
  "[STAFF]",
  "[PROPERTY]",
  "[EMAIL]",
  "[PHONE]",
  "[URL]",
  "[NUMBER]",
  "[NAME]",
] as const;

const NOT_LETTER_BEFORE = "(?<![\\p{L}\\p{N}])";
const NOT_LETTER_AFTER = "(?![\\p{L}\\p{N}])";

const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"]+/giu;
const EMAIL_RE = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu;
/** "@anna.t" — dots inside, never the full stop after it. */
const HANDLE_RE = /(?<![\p{L}\p{N}])@[\p{L}\p{N}_]{2,}(?:\.[\p{L}\p{N}_]+)*/gu;
/** A run of digits with spaces, dots, dashes or brackets between: a phone at nine digits or more. */
const PHONE_RE = /\+?\d[\d ().-]{7,}\d/gu;
const PHONE_MIN_DIGITS = 9;
const NUMBER_RE = /\d{4,}/gu;

/** Greetings and thanks before a name, en/de/cs/ru — each word in either case at its first letter. */
const GREETINGS = [
  "thanks",
  "thank you",
  "hi",
  "hello",
  "dear",
  "danke",
  "hallo",
  "liebe",
  "lieber",
  "díky",
  "děkuji",
  "děkujeme",
  "ahoj",
  "milá",
  "milý",
  "спасибо",
  "привет",
  "дорогая",
  "дорогой",
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** "thanks" → "[tT]hanks": the greeting in either case, the name after it with its capital. */
function eitherCase(word: string): string {
  const first = word.charAt(0);
  return `[${first.toLowerCase()}${first.toUpperCase()}]${escapeRegExp(word.slice(1))}`;
}

const GREETING_RE = new RegExp(
  `${NOT_LETTER_BEFORE}(${GREETINGS.map(eitherCase).join("|")})(,?\\s+)(\\p{Lu}\\p{Ll}+)`,
  "gu",
);

/** The words of the names, two letters or more, each written as given and in capitals. */
function nameWords(names: readonly string[]): string[] {
  const words = new Set<string>();
  for (const name of names) {
    for (const word of name.split(/[\s\-'’.,]+/u)) {
      if ([...word].filter((ch) => /\p{L}/u.test(ch)).length >= 2) {
        words.add(word);
        words.add(word.toUpperCase());
        const capital = word.charAt(0).toUpperCase() + word.slice(1);
        words.add(capital);
      }
    }
  }
  // Longest first, so "Anna-Marie" goes before "Anna".
  return [...words].sort((a, b) => b.length - a.length);
}

function replaceWords(text: string, words: readonly string[], placeholder: string): string {
  if (words.length === 0) {
    return text;
  }
  const pattern = new RegExp(
    `${NOT_LETTER_BEFORE}(?:${words.map(escapeRegExp).join("|")})${NOT_LETTER_AFTER}`,
    "gu",
  );
  return text.replace(pattern, placeholder);
}

function replacePhrases(text: string, phrases: readonly string[], placeholder: string): string {
  const usable = [...new Set(phrases.map((p) => p.trim()).filter((p) => p.length >= 4))].sort(
    (a, b) => b.length - a.length,
  );
  if (usable.length === 0) {
    return text;
  }
  const pattern = new RegExp(
    `${NOT_LETTER_BEFORE}(?:${usable.map(escapeRegExp).join("|")})${NOT_LETTER_AFTER}`,
    "giu",
  );
  return text.replace(pattern, placeholder);
}

/** One text, redacted. Idempotent: a placeholder is never taken for a name. */
export function redactText(text: string, names: RedactionNames): string {
  let out = text;
  out = out.replace(URL_RE, "[URL]");
  out = out.replace(EMAIL_RE, "[EMAIL]");
  out = out.replace(HANDLE_RE, "[NAME]");
  out = out.replace(PHONE_RE, (match) =>
    match.replace(/\D/g, "").length >= PHONE_MIN_DIGITS ? "[PHONE]" : match
  );
  out = replacePhrases(out, names.places, "[PROPERTY]");
  out = replaceWords(out, nameWords(names.guest), "[GUEST]");
  out = replaceWords(out, nameWords(names.staff), "[STAFF]");
  out = out.replace(NUMBER_RE, "[NUMBER]");
  out = out.replace(GREETING_RE, (_match, greeting: string, gap: string) => `${greeting}${gap}[NAME]`);
  return out;
}
