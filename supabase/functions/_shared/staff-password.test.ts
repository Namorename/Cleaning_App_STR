import { assertEquals, assertMatch, assertNotEquals, assertThrows } from "jsr:@std/assert@1";
import { generatePassword, passwordStem, RANDOM_LENGTH, transliterate } from "./staff-password.ts";

/** A random source that hands back the bytes a test names. */
function fixedBytes(...values: number[]): (length: number) => Uint8Array {
  return () => new Uint8Array(values);
}

const ZEROS = fixedBytes(0, 0, 0, 0, 0);

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
  assertEquals(generatePassword("Anna", "a@example.com", fixedBytes(0, 1, 2, 3, 4)), "Anna-abcde");
  // 24 is the first digit, 31 the last character, and 32 wraps back to the
  // start — the modulo is exact, so no character is favoured over another.
  assertEquals(generatePassword("Мария", "m@example.com", fixedBytes(0, 1, 24, 31, 32)), "Mariya-ab29a");
});

Deno.test("look-alike characters never appear", () => {
  // Every byte a CSPRNG can produce, and not one of them may give l, o, 0 or 1.
  for (let byte = 0; byte < 256; byte += 1) {
    const password = generatePassword("Anna", "a@example.com", fixedBytes(byte, byte, byte, byte, byte));
    const tail = password.slice("Anna-".length);
    assertEquals(tail.length, RANDOM_LENGTH);
    assertMatch(tail, /^[abcdefghijkmnpqrstuvwxyz23456789]+$/);
  }
});

Deno.test("two passwords in a row are not the same", () => {
  assertNotEquals(
    generatePassword("Anna", "a@example.com"),
    generatePassword("Anna", "a@example.com"),
  );
});

Deno.test("the shape is Name-xxxxx whatever the name was", () => {
  assertMatch(
    generatePassword("Мария Иванова", "m@example.com", ZEROS),
    /^[A-Za-z][a-z0-9]*-[a-z0-9]{5}$/,
  );
  assertMatch(generatePassword(null, "→@example.com", ZEROS), /^Staff-[a-z0-9]{5}$/);
});

Deno.test("a random source that gives too little is refused, not padded", () => {
  assertThrows(
    () => generatePassword("Anna", "a@example.com", fixedBytes(1, 2)),
    RangeError,
    "2 bytes",
  );
});
