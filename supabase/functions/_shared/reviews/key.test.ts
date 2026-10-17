import { assert, assertEquals, assertNotEquals, assertThrows } from "jsr:@std/assert@1";

import { ConfigError } from "../env.ts";
import { createReviewKeyer, readReviewIdSecret, REVIEW_ID_SECRET_ENV } from "./key.ts";

// A secret for tests only — the one supabase/tests/reviews_to_tasks.sql keys
// its rows with (pg_temp.review_key), so the two sides are checked against
// each other. The cloud's secret is the owner's and is in no file.
const TEST_SECRET = "test-only-review-id-secret-0123456789abcdef";

function env(values: Record<string, string>) {
  return { get: (key: string) => values[key] };
}

Deno.test("the key is the HMAC the database test helper makes: same id, same key", async () => {
  const keyOf = await createReviewKeyer("hostaway", TEST_SECRET);
  assertEquals(
    await keyOf("suite-1"),
    "8479f7dc7febbc3f36f43922b222eb70560e01f639cc4d76cd7ac395122340f1",
  );
  assertEquals(await keyOf("suite-1"), await keyOf("suite-1"));
  assert(/^[0-9a-f]{64}$/.test(await keyOf("90000001")));
});

Deno.test("the key says nothing of the id: another secret or another source, another key", async () => {
  const ours = await createReviewKeyer("hostaway", TEST_SECRET);
  const other = await createReviewKeyer("hostaway", `${TEST_SECRET}-other`);
  const otherSource = await createReviewKeyer("other-pms", TEST_SECRET);
  assertNotEquals(await ours("90000001"), await other("90000001"));
  assertNotEquals(await ours("90000001"), await otherSource("90000001"));
  assert(!(await ours("90000001")).includes("90000001"));
});

Deno.test("no secret or a short one stops the function, and the message never shows it", () => {
  const missing = assertThrows(() => readReviewIdSecret(env({})), ConfigError);
  assert(missing.message.includes(REVIEW_ID_SECRET_ENV));
  const short = "too-short-secret";
  const tooShort = assertThrows(
    () => readReviewIdSecret(env({ [REVIEW_ID_SECRET_ENV]: short })),
    ConfigError,
  );
  assert(!tooShort.message.includes(short), "the secret went into the message");
  assertEquals(readReviewIdSecret(env({ [REVIEW_ID_SECRET_ENV]: ` ${TEST_SECRET} ` })), TEST_SECRET);
});
