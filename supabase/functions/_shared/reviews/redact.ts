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
 * cleaner must not take "we will come back" with him. Every part of a name
 * counts on its own, with the endings the guests' languages give it ("Anna"
 * → "Anny", "Annou"; "Novák" → "Nováka", "Novákovi", "Nováková"; "Мария" →
 * "Марии", "Марией") and written without its accents ("Novakova"): the
 * owner's decision of 2026-10-18 — a name in a text goes before the text is
 * stored or sent, as surely as can be done without a model. A little too much
 * goes rather than too little.
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

/**
 * The endings a name takes in Czech, Slovak, Polish, Russian, Ukrainian,
 * German and English, after its stem. Written lower case; the capitals form
 * takes them in capitals.
 */
const NAME_ENDINGS = [
  // cs / sk ("Novotný" → "Novotného", "Jiří" → "Jiřího", "Dvořákovi" → "Dvořákových")
  "a", "e", "é", "ě", "i", "í", "o", "u", "ú", "y", "ý", "ou", "ej", "em", "ovi", "ům", "ách",
  "ech", "ová", "ové", "ovou", "ův", "ova", "ovo", "ovy", "ým", "ých", "ými", "ého", "ému",
  "ím", "ího", "ímu", "ových", "ovými",
  // pl ("Kowalski" → "Kowalskiego")
  "ą", "ę", "owi", "iego", "iemu", "im",
  // ru / uk ("Марія" → "Марії", "Марією"; "Іван" → "Іванові")
  "а", "я", "у", "ю", "е", "и", "ы", "ой", "ей", "ою", "ею", "ом", "ем", "ём", "ым", "им",
  "ыми", "ах", "ях", "ами", "ова", "ову", "овой", "ина", "ину", "иной", "ович", "овна", "евич",
  "евна", "і", "ї", "є", "о", "ові", "єю",
  // de / en
  "s", "n", "ns",
];

/** The final letter a stem drops before an ending: "Anna" → "Ann-ou", "Мария" → "Мари-ей", "Игорь" → "Игор-ем". */
const DROPS_BEFORE_ENDING = /[aeiouyáéěíóúůýаяоеёиуыюэйьіїє]$/iu;

/** Letters NFD does not take apart: "Łukasz" is written "Lukasz" just as often. */
const UNFOLDED: Readonly<Record<string, string>> = {
  ł: "l",
  Ł: "L",
  ø: "o",
  Ø: "O",
  đ: "d",
  Đ: "D",
  ß: "ss",
};

/** Czech and Slovak drop the e of a last syllable: "Marek" → "Mark-a", "Pavel" → "Pavl-a". */
const MOBILE_E = /^(.*\p{L})e(\p{L})$/u;

/** Czech softens the last consonant before e and i: "Olga" → "Olze", "Hanka" → "Hance", "Petr" → "Petře". */
const SOFTENED: ReadonlyArray<readonly [RegExp, string]> = [
  [/ch$/u, "š"],
  [/k$/u, "c"],
  [/[gh]$/u, "z"],
  [/r$/u, "ř"],
];
const SOFTENED_ENDINGS = ["e", "ě", "i"];

/** The accents off: what a guest without a Czech keyboard writes ("Nováková" → "Novakova"). */
function fold(word: string): string {
  return word.normalize("NFD").replace(/\p{M}/gu, "").replace(/[łŁøØđĐß]/gu, (ch) => UNFOLDED[ch])
    .normalize("NFC");
}

function letterCount(word: string): number {
  return [...word].filter((ch) => /\p{L}/u.test(ch)).length;
}

function capitalised(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** The parts of a name: anything that is not a letter divides them ("Anna/Tom", "(Ann)", "O'Brien"). */
function nameParts(name: string): string[] {
  return name.normalize("NFC").split(/[^\p{L}]+/u).filter((part) => letterCount(part) >= 2);
}

/**
 * There is a name to take out at all: one part of two letters or more. A
 * PMS that writes "-" or "J" for the guest gives none, and then a text must
 * not go out as if it had been redacted.
 */
export function hasUsableName(names: readonly string[]): boolean {
  return names.some((name) => nameParts(name).length > 0);
}

/**
 * The ways a part is written in a text: with a capital, in capitals (by the
 * stem patterns), without accents — and as the PMS wrote it when that starts
 * with a capital ("McDonald"). Never in lower case: a PMS that wrote
 * "will smith" must not take "we will come back" with it, and one that wrote
 * "ANNA" still takes "Anna".
 */
function writtenForms(part: string): Set<string> {
  const lower = part.toLowerCase();
  const forms = new Set([capitalised(lower), capitalised(fold(lower))]);
  if (part.charAt(0) !== part.charAt(0).toLowerCase()) {
    forms.add(part);
    forms.add(fold(part));
  }
  return forms;
}

const ENDINGS = [...new Set([...NAME_ENDINGS, ...NAME_ENDINGS.map(fold)])]
  .sort((a, b) => b.length - a.length);
const ENDINGS_LOWER = ENDINGS.map(escapeRegExp).join("|");
const ENDINGS_UPPER = ENDINGS.map((ending) => escapeRegExp(ending.toUpperCase())).join("|");

/** The stems of one written form: itself, without its last vowel, without its mobile e. */
function stemsOf(form: string): string[] {
  const stems = [form];
  if (DROPS_BEFORE_ENDING.test(form) && letterCount(form) > 2) {
    stems.push(form.slice(0, -1));
  }
  const mobile = MOBILE_E.exec(form);
  if (mobile !== null && letterCount(form) > 3) {
    stems.push(`${mobile[1]}${mobile[2]}`);
  }
  return stems;
}

/** "Olz", "Hanc", "Petř": a stem with its last consonant softened, which takes only e, ě or i. */
function softenedStems(stems: readonly string[]): string[] {
  return stems.flatMap((stem) =>
    SOFTENED.filter(([last]) => last.test(stem) && letterCount(stem) > 2)
      .map(([last, soft]) => stem.replace(last, soft))
  );
}

/**
 * One pattern a word of a name may appear as: each part of two letters or
 * more, in the forms writtenForms() gives, each with its endings — and all
 * of it in capitals too.
 */
function namePatterns(names: readonly string[]): string[] {
  const patterns = new Set<string>();
  for (const name of names) {
    for (const part of nameParts(name)) {
      for (const form of writtenForms(part)) {
        const stems = stemsOf(form);
        for (const stem of stems) {
          patterns.add(`${escapeRegExp(stem)}(?:${ENDINGS_LOWER})?`);
          patterns.add(`${escapeRegExp(stem.toUpperCase())}(?:${ENDINGS_UPPER})?`);
        }
        for (const soft of softenedStems(stems)) {
          for (const variant of new Set([soft, fold(soft)])) {
            patterns.add(`${escapeRegExp(variant)}(?:${SOFTENED_ENDINGS.join("|")})`);
            patterns.add(
              `${escapeRegExp(variant.toUpperCase())}(?:${SOFTENED_ENDINGS.join("|").toUpperCase()})`,
            );
          }
        }
      }
    }
  }
  // Longest first, so "Anna-Marie" goes before "Anna".
  return [...patterns].sort((a, b) => b.length - a.length);
}

function replaceNames(text: string, names: readonly string[], placeholder: string): string {
  const patterns = namePatterns(names);
  if (patterns.length === 0) {
    return text;
  }
  const pattern = new RegExp(`${NOT_LETTER_BEFORE}(?:${patterns.join("|")})${NOT_LETTER_AFTER}`, "gu");
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

/**
 * One text, redacted. Idempotent: a placeholder is never taken for a name.
 * Composed (NFC) first, as the names are: an accent typed as a separate mark
 * must not hide a name.
 */
export function redactText(text: string, names: RedactionNames): string {
  let out = text.normalize("NFC");
  out = out.replace(URL_RE, "[URL]");
  out = out.replace(EMAIL_RE, "[EMAIL]");
  out = out.replace(HANDLE_RE, "[NAME]");
  out = out.replace(PHONE_RE, (match) =>
    match.replace(/\D/g, "").length >= PHONE_MIN_DIGITS ? "[PHONE]" : match
  );
  out = replacePhrases(out, names.places, "[PROPERTY]");
  out = replaceNames(out, names.guest, "[GUEST]");
  out = replaceNames(out, names.staff, "[STAFF]");
  out = out.replace(NUMBER_RE, "[NUMBER]");
  out = out.replace(GREETING_RE, (_match, greeting: string, gap: string) => `${greeting}${gap}[NAME]`);
  return out;
}
