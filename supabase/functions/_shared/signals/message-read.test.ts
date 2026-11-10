import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";

import { ModelError } from "./classify.ts";
import {
  AnthropicMessageThemeClient,
  fitMessages,
  MESSAGE_MAX_CHARS,
  MESSAGE_THEMES_DETECTOR,
  MESSAGE_THEMES_SCHEMA,
  MESSAGE_THEMES_SYSTEM_PROMPT,
  parseMessageThemes,
  redactMessage,
  renderMessageThemeInput,
  THEMES_BLOCK,
} from "./message-read.ts";
import { ISSUE_THEMES } from "./themes.ts";
import { THEMES_DETECTOR, THEMES_SYSTEM_PROMPT } from "./themes-read.ts";

const NAMES = { guest: ["Fakeguest Synthova"], staff: ["Tomas Technik"], places: ["Fake Flat One"] };

Deno.test("a chat is read by the reviews' themes, word for word, and their version", () => {
  assert(THEMES_BLOCK.startsWith("Themes:\n- heating:"));
  assert(THEMES_SYSTEM_PROMPT.endsWith(THEMES_BLOCK));
  assert(MESSAGE_THEMES_SYSTEM_PROMPT.endsWith(THEMES_BLOCK));
  for (const theme of ISSUE_THEMES) {
    assert(THEMES_BLOCK.includes(`- ${theme}:`), theme);
  }
  assertEquals(MESSAGE_THEMES_SCHEMA.properties.complaints.items.properties.theme.enum, [...ISSUE_THEMES]);
  assertEquals(MESSAGE_THEMES_DETECTOR, `${THEMES_DETECTOR}-msg`);
  assert(/^[a-z0-9.@_-]{3,80}$/.test(MESSAGE_THEMES_DETECTOR), "issue_facts.detector's check");
});

Deno.test("the user turn says when in the stay and keeps earlier messages apart", () => {
  const turn = renderMessageThemeInput({
    channel: "airbnb",
    phase: "arrival_day",
    earlier: ["first"],
    fresh: ["second", "third"],
  });
  assertEquals(
    turn,
    "Channel: airbnb\nWhen: the day of arrival\n<earlier_message>\nfirst\n</earlier_message>\n" +
      "<new_message>\nsecond\n</new_message>\n<new_message>\nthird\n</new_message>",
  );
});

Deno.test("a chat's codes, cards and accounts never reach the model", () => {
  const out = redactMessage(
    "Hi, the door code 4B7X does not work, wifi password Prague2024 neither. " +
      "Pay to CZ65 0800 0000 1920 0014 5399 or card 4111 1111 1111 1111. Fakeguest, call 777 123 456.",
    NAMES,
  );
  for (const secret of ["4B7X", "Prague2024", "CZ65", "4111", "777", "Fakeguest"]) {
    assert(!out.includes(secret), `${secret} left in: ${out}`);
  }
  assert(out.includes("[CODE]"));
  assert(out.includes("[CARD]"));
  assert(out.includes("[ID]"));
});

Deno.test("the redaction of a chat is the reviews' and more, never less", () => {
  const text = "Thanks Anna, Tomas fixed it at Fake Flat One, see https://x.example";
  const out = redactMessage(text, NAMES);
  assert(!out.includes("Tomas"));
  assert(!out.includes("Fake Flat One"));
  assert(!out.includes("https://"));
  assert(!out.includes("Anna"));
  // Ordinary words with digits a guest writes stay readable enough, and a
  // complaint keeps its words after the word "wifi" or "code".
  assert(redactMessage("We arrive at 15:00 with 2 kids", NAMES).includes("15:00"));
  assertEquals(redactMessage("the wifi doesn't work", NAMES), "the wifi doesn't work");
  assertEquals(redactMessage("the code does not open the door", NAMES), "the code does not open the door");
  assertEquals(redactMessage("heslo: kocka", NAMES), "heslo: [CODE]");
});

Deno.test("one reading sends the new messages first and at most its length", () => {
  const long = "x".repeat(MESSAGE_MAX_CHARS + 500);
  const fit = fitMessages(["a", long], ["e1", "e2", "e3", "e4"]);
  const total = [...fit.fresh, ...fit.earlier].join("").length;
  assert(total <= MESSAGE_MAX_CHARS);
  assertEquals(fit.earlier, []);
  const short = fitMessages(["new"], ["e1", "e2", "e3", "e4"]);
  assertEquals(short, { fresh: ["new"], earlier: ["e2", "e3", "e4"] });
});

Deno.test("the answer is checked: unknown themes out, one item a theme, resolved only when said", () => {
  const answer = parseMessageThemes({
    complaints: [
      { theme: "hot_water", severity: "high", confidence: 0.7, resolved: false },
      { theme: "hot_water", severity: "normal", confidence: 0.9, resolved: true },
      { theme: "wifi", severity: "loud", confidence: 3 },
      { theme: "toaster", severity: "high", confidence: 1 },
      "noise",
    ],
  });
  assertEquals(answer.invalid, 2);
  assertEquals(answer.labels, [
    { theme: "hot_water", severity: "normal", confidence: 0.9, resolved: true },
    { theme: "wifi", severity: "normal", confidence: 1, resolved: false },
  ]);
  assertThrows(() => parseMessageThemes({ findings: [] }), ModelError);
});

Deno.test("the client asks the model once, by schema, and returns the tokens", async () => {
  const calls: unknown[] = [];
  const client = new AnthropicMessageThemeClient("test-key", {
    fetch: (_input, init) => {
      calls.push(JSON.parse(String(init?.body)));
      return Promise.resolve(Response.json({
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-haiku-5-5",
        stop_reason: "end_turn",
        content: [{ type: "text", text: '{"complaints":[]}' }],
        usage: { input_tokens: 1200, output_tokens: 20 },
      }));
    },
  });
  const reading = await client.read({ channel: "booking", phase: "stay", earlier: [], fresh: ["cold"] });
  assertEquals(reading, { raw: { complaints: [] }, inputTokens: 1200, outputTokens: 20 });
  assertEquals(calls.length, 1);
  const body = calls[0] as { system: string; messages: { content: string }[] };
  assertEquals(body.system, MESSAGE_THEMES_SYSTEM_PROMPT);
  assert(body.messages[0].content.includes("<new_message>\ncold\n</new_message>"));
});

Deno.test("a refused key is the service's failure, with a code and no words", async () => {
  const client = new AnthropicMessageThemeClient("test-key", {
    fetch: () => Promise.resolve(Response.json({ type: "error", error: { type: "authentication_error", message: "x" } }, { status: 401 })),
  });
  const error = await assertRejects(
    () => client.read({ channel: "booking", phase: "stay", earlier: [], fresh: ["FAKE-GUEST-TEXT"] }),
    ModelError,
  );
  assertEquals(error.code, "service_key_rejected");
  assertEquals(error.scope, "service");
  assert(!error.message.includes("FAKE-GUEST-TEXT"));
});
