/**
 * The password a manager hands over.
 *
 * Shape: `Name-xxxxx` — the person's own name, a hyphen, five random
 * characters. The name is there so that a password read out over the phone,
 * or found written on a note a week later, is obviously that person's and not
 * a stray string; the five characters are what actually makes it a password.
 *
 * Two decisions inside are worth stating.
 *
 * **The name is transliterated to Latin.** A cleaner types this on a phone,
 * and "Мария-a7k2p" would make her switch keyboard layouts in the middle of
 * her own password — in a masked field, where she cannot see what went wrong.
 * The manager still sees "Мария" everywhere in the panel; only the password
 * stem is Latin, and it is recognisably her name.
 *
 * **The alphabet has no look-alikes.** `l` `1` `I` and `o` `0` `O` are the
 * characters people mistype when they copy something by hand, and this
 * password is copied by hand more often than not. What is left is exactly 32
 * characters, which also makes `byte % 32` an unbiased choice: 256 divides by
 * 32 evenly, so no character of the alphabet comes up more often than another.
 */

/** Cyrillic to Latin, applied before diacritics are stripped so й and ё survive as themselves. */
const CYRILLIC: Readonly<Record<string, string>> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/** 24 letters and 8 digits: no l, o, 0 or 1. Exactly 32 — see the note above. */
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

export const RANDOM_LENGTH = 5;

/** Long enough to be a name, short enough that the whole password fits a glance. */
const MAX_STEM = 12;

/** When there is nothing to build a stem from. Still a word, not a blank. */
const FALLBACK_STEM = "Staff";

/**
 * Combining marks, the tail of an NFD-decomposed accented letter.
 *
 * Written as escapes on purpose: the characters themselves are invisible in
 * an editor, and a range nobody can see is a range nobody can check.
 */
const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

export type RandomBytes = (length: number) => Uint8Array;

const systemRandom: RandomBytes = (length) => crypto.getRandomValues(new Uint8Array(length));

function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(COMBINING_MARKS, "");
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Whatever a person is called, as Latin letters and digits.
 *
 * Anything that survives neither the Cyrillic table nor diacritic stripping —
 * spaces, hyphens, apostrophes, a script the table does not know — is dropped
 * rather than guessed at.
 */
export function transliterate(value: string): string {
  const latin = [...value.toLowerCase()].map((char) => CYRILLIC[char] ?? char).join("");
  return stripDiacritics(latin).replace(/[^a-z0-9]/g, "");
}

/**
 * The part of the password that names the person.
 *
 * The given name first — that is what people answer to. An account with no
 * name falls back to the address it signs in with, because a stem taken from
 * the login is still recognisable; only when neither says anything printable
 * does the generic word appear.
 */
export function passwordStem(fullName: string | null | undefined, email: string): string {
  const givenName = (fullName ?? "").trim().split(/\s+/)[0] ?? "";
  const fromName = transliterate(givenName).slice(0, MAX_STEM);
  if (fromName !== "") {
    return capitalize(fromName);
  }

  const localPart = email.split("@")[0] ?? "";
  const fromEmail = transliterate(localPart).slice(0, MAX_STEM);
  return fromEmail === "" ? FALLBACK_STEM : capitalize(fromEmail);
}

/**
 * A fresh password for this person.
 *
 * `randomBytes` is a parameter so a test can say what the tail will be; in
 * production it is the platform CSPRNG and nothing else.
 */
export function generatePassword(
  fullName: string | null | undefined,
  email: string,
  randomBytes: RandomBytes = systemRandom,
): string {
  const bytes = randomBytes(RANDOM_LENGTH);
  if (bytes.length < RANDOM_LENGTH) {
    throw new RangeError(`Random source returned ${bytes.length} bytes, ${RANDOM_LENGTH} needed`);
  }

  let tail = "";
  for (let index = 0; index < RANDOM_LENGTH; index += 1) {
    tail += ALPHABET[bytes[index] % ALPHABET.length];
  }

  return `${passwordStem(fullName, email)}-${tail}`;
}
