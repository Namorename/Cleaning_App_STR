import { createHmac } from "node:crypto";

import { assert, assertEquals, assertNotEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";

import { ConfigError } from "../env.ts";
import {
  createConversationKeyer,
  createSignalKeyer,
  readSignalKeySecret,
  SIGNAL_KEY_SECRET_ENV,
} from "./key.ts";

// A secret for tests only; the cloud's secret is the owner's and is in no
// file. The expected keys are computed here by a second HMAC implementation
// (node:crypto), so the test checks the input the key is made of, not a
// number copied from somewhere.
const TEST_SECRET = "test-only-signal-key-secret-0123456789abcdef";

function expected(input: string, secret = TEST_SECRET): string {
  return createHmac("sha256", secret).update(input, "utf8").digest("hex");
}

function env(values: Record<string, string>) {
  return { get: (key: string) => values[key] };
}

Deno.test("a signal's key is the HMAC of provider:kind:id", async () => {
  const reviews = await createSignalKeyer("hostaway", "review", TEST_SECRET);
  const messages = await createSignalKeyer("hostaway", "message", TEST_SECRET);
  assertEquals(await reviews("90000001"), expected("hostaway:review:90000001"));
  assertEquals(await messages("60000001"), expected("hostaway:message:60000001"));
  assertEquals(await reviews("90000001"), await reviews("90000001"));
  assert(/^[0-9a-f]{64}$/.test(await reviews("90000001")));
});

Deno.test("the keyer and the database's suite make one key of one id (the shared vector)", async () => {
  // supabase/tests/guest_signals.sql keys its rows with pg_temp.review_key() under
  // its own test secret and checks the same hex: the two sides never drift apart.
  const suiteKeyer = await createSignalKeyer(
    "hostaway",
    "review",
    "test-only-review-id-secret-0123456789abcdef",
  );
  assertEquals(
    await suiteKeyer("suite-1"),
    "a6a574f2019c76a93d1e1ca27557345cba7317e84453f427fd8fe9b6fa69069b",
  );
});

Deno.test("a conversation's key is the HMAC of provider:conversation:id", async () => {
  const conversations = await createConversationKeyer("hostaway", TEST_SECRET);
  assertEquals(await conversations("70000001"), expected("hostaway:conversation:70000001"));
});

Deno.test("the key says nothing of the id: another secret, provider or kind gives another key", async () => {
  const ours = await createSignalKeyer("hostaway", "review", TEST_SECRET);
  const otherSecret = await createSignalKeyer("hostaway", "review", `${TEST_SECRET}-other`);
  const otherProvider = await createSignalKeyer("fake", "review", TEST_SECRET);
  const otherKind = await createSignalKeyer("hostaway", "message", TEST_SECRET);
  const conversation = await createConversationKeyer("hostaway", TEST_SECRET);
  const key = await ours("90000001");
  for (const other of [otherSecret, otherProvider, otherKind, conversation]) {
    assertNotEquals(key, await other("90000001"));
  }
  assertEquals(await otherSecret("90000001"), expected("hostaway:review:90000001", `${TEST_SECRET}-other`));
  assert(!key.includes("90000001"));
});

Deno.test("an empty id has no key: every signal without one would meet in one row", async () => {
  const keyOf = await createSignalKeyer("hostaway", "review", TEST_SECRET);
  await assertRejects(() => keyOf(""), Error, "needs the PMS's id");
});

Deno.test("no secret or a short one stops the function, and the message never shows it", () => {
  assertEquals(SIGNAL_KEY_SECRET_ENV, "GUEST_SIGNAL_KEY_SECRET");
  const missing = assertThrows(() => readSignalKeySecret(env({})), ConfigError);
  assert(missing.message.includes(SIGNAL_KEY_SECRET_ENV));
  const short = "too-short-secret";
  const tooShort = assertThrows(
    () => readSignalKeySecret(env({ [SIGNAL_KEY_SECRET_ENV]: short })),
    ConfigError,
  );
  assert(!tooShort.message.includes(short), "the secret went into the message");
  assertEquals(readSignalKeySecret(env({ [SIGNAL_KEY_SECRET_ENV]: ` ${TEST_SECRET} ` })), TEST_SECRET);
});
