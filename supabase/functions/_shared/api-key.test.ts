import { assert, assertEquals, assertMatch, assertNotEquals } from "jsr:@std/assert@1";

import {
  displayPrefix,
  generateApiKey,
  hmacHex,
  keyDigest,
  looksLikeApiKey,
  MIN_PEPPER_LENGTH,
  readPepper,
  sha256Hex,
  timingSafeEqual,
} from "./api-key.ts";

Deno.test("a key is woom_ and 43 base64url characters of 32 random bytes", () => {
  const key = generateApiKey();
  assertMatch(key, /^woom_[A-Za-z0-9_-]{43}$/);
  assert(looksLikeApiKey(key));
});

Deno.test("two keys are never the same", () => {
  const keys = new Set(Array.from({ length: 200 }, () => generateApiKey()));
  assertEquals(keys.size, 200);
});

Deno.test("the shown prefix is twelve characters and not the key", () => {
  const key = generateApiKey();
  assertEquals(displayPrefix(key).length, 12);
  assert(key.startsWith(displayPrefix(key)));
  assertNotEquals(displayPrefix(key), key);
});

Deno.test("HMAC-SHA256 matches RFC 4231 test case 2", async () => {
  assertEquals(
    await hmacHex("Jefe", "what do ya want for nothing?"),
    "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
  );
});

Deno.test("a digest depends on the pepper: the database's copy alone proves nothing", async () => {
  const key = generateApiKey();
  const one = await keyDigest("a".repeat(MIN_PEPPER_LENGTH), key);
  const two = await keyDigest("b".repeat(MIN_PEPPER_LENGTH), key);
  assertMatch(one, /^[0-9a-f]{64}$/);
  assertNotEquals(one, two);
  assertNotEquals(one, await sha256Hex(key));
});

Deno.test("timingSafeEqual: equal, unequal, other length", () => {
  assert(timingSafeEqual("abcdef", "abcdef"));
  assert(!timingSafeEqual("abcdef", "abcdeg"));
  assert(!timingSafeEqual("abc", "abcd"));
});

Deno.test("a pepper shorter than 32 characters is no pepper", () => {
  assertEquals(readPepper({ get: () => "short" }), null);
  assertEquals(readPepper({ get: () => undefined }), null);
  assertEquals(readPepper({ get: () => "x".repeat(32) }), "x".repeat(32));
});
