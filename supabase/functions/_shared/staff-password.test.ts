import { assertEquals, assertMatch, assertNotEquals, assertThrows } from "jsr:@std/assert@1";
import {
  ALPHABET,
  generatePassword,
  passwordStem,
  RANDOM_LENGTH,
  transliterate,
} from "./staff-password.ts";

/** A random source that hands back the same bytes on every draw. */
function fixedBytes(...values: number[]): (length: number) => Uint8Array {
  return () => new Uint8Array(values);
}

/** A random source scripted draw by draw; the last block repeats once it runs out. */
function scriptedBytes(...draws: number[][]): (length: number) => Uint8Array {
  let index = 0;
  return () => new Uint8Array(draws[Math.min(index++, draws.length - 1)]);
}

/**
 * Indices into the alphabet: 0–23 small, 24–47 capitals, 48–55 digits, 56–63 marks.
 * This draw spells `abA!2` — a capital and a mark, so it is kept on the first go.
 */
const KEPT = fixedBytes(0, 1, 24, 56, 48);

// ---------------------------------------------------------------------------
//  The stem is the person's name, in letters any keyboard has.
// ---------------------------------------------------------------------------

Deno.test("a Russian name becomes Latin", () => {
  assertEquals(transliterate("Мария"), "mariya");
  assertEquals(transliterate("Андрей"), "andrey");
  assertEquals(transliterate("Щукин"), "schukin");
  assertEquals(transliterate("Ёлкина"), "elkina");
});

Deno.test("Czech diacritics lose their marks, not their letters", () => {
  assertEquals(transliterate("Šárka"), "sarka");
  assertEquals(transliterate("Dvořák"), "dvorak");
});

Deno.test("everything that is not a letter or a digit is dropped", () => {
  assertEquals(transliterate("O'Brien-Smith"), "obriensmith");
  assertEquals(transliterate("   "), "");
  assertEquals(transliterate("→ ✓"), "");
});

Deno.test("the stem is the given name, not the whole of it", () => {
  assertEquals(passwordStem("Мария Иванова", "m@example.com"), "Mariya");
  assertEquals(passwordStem("  Anna   Nováková ", "a@example.com"), "Anna");
});

Deno.test("a long name is cut to something that still fits a glance", () => {
  assertEquals(passwordStem("Константинопольский", "k@example.com"), "Konstantinop");
});

Deno.test("no name falls back to the address the person signs in with", () => {
  assertEquals(passwordStem(null, "maria.ivanova@example.com"), "Mariaivanova");
  assertEquals(passwordStem("   ", "anna@example.com"), "Anna");
});

Deno.test("a name and an address that say nothing printable still give a word", () => {
  assertEquals(passwordStem("→", "→@example.com"), "Staff");
});

// ---------------------------------------------------------------------------
//  The tail is what makes it a password.
// ---------------------------------------------------------------------------

Deno.test("the tail is read out of the alphabet in order", () => {
  assertEquals(generatePassword("Anna", "a@example.com", KEPT), "Anna-abA!2");
});

Deno.test("the modulo is exact, so no character is favoured over another", () => {
  // 64 wraps back to the start of the alphabet and spells the same tail.
  assertEquals(
    generatePassword("Мария", "m@example.com", fixedBytes(64, 65, 88, 120, 112)),
    "Mariya-abA!2",
  );
  assertEquals(256 % ALPHABET.length, 0);
});

Deno.test("the alphabet is 64 distinct characters with no look-alikes", () => {
  assertEquals(ALPHABET.length, 64);
  assertEquals(new Set(ALPHABET).size, 64);

  // A 1 and a 0 have three impostors between them; the hyphen already means
  // "the name ends here" and may not turn up inside the tail.
  for (const impostor of ["l", "I", "o", "O", "0", "1", "-"]) {
    assertEquals(ALPHABET.includes(impostor), false, `${impostor} is in the alphabet`);
  }
});

Deno.test("every password carries a capital and a mark", () => {
  // The real CSPRNG, not a script: this is the promise the drawing makes.
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const tail = generatePassword("Anna", "a@example.com").slice("Anna-".length);
    assertEquals(tail.length, RANDOM_LENGTH);
    assertMatch(tail, /[A-Z]/, `no capital in ${tail}`);
    assertMatch(tail, /[!#$%*+=?]/, `no mark in ${tail}`);
    assertMatch(tail, /^[a-zA-Z2-9!#$%*+=?]+$/, `stray character in ${tail}`);
  }
});

Deno.test("a draw with no capital or no mark is thrown away whole", () => {
  // abcde has neither, aBcde has no mark; the third draw is the first keeper,
  // and it is taken as it came rather than patched up.
  const source = scriptedBytes([0, 1, 2, 3, 4], [0, 25, 2, 3, 4], [0, 1, 24, 56, 48]);

  assertEquals(generatePassword("Anna", "a@example.com", source), "Anna-abA!2");
});

Deno.test("a source stuck on one value is refused, not looped forever", () => {
  assertThrows(
    () => generatePassword("Anna", "a@example.com", fixedBytes(0, 0, 0, 0, 0)),
    Error,
    "stuck",
  );
});

Deno.test("two passwords in a row are not the same", () => {
  assertNotEquals(
    generatePassword("Anna", "a@example.com"),
    generatePassword("Anna", "a@example.com"),
  );
});

Deno.test("the shape is Name-xxxxx whatever the name was", () => {
  assertMatch(
    generatePassword("Мария Иванова", "m@example.com", KEPT),
    /^[A-Za-z][a-z0-9]*-[a-zA-Z2-9!#$%*+=?]{5}$/,
  );
  assertMatch(generatePassword(null, "→@example.com", KEPT), /^Staff-[a-zA-Z2-9!#$%*+=?]{5}$/);
});

Deno.test("a random source that gives too little is refused, not padded", () => {
  assertThrows(
    () => generatePassword("Anna", "a@example.com", fixedBytes(1, 2)),
    RangeError,
    "2 bytes",
  );
});
