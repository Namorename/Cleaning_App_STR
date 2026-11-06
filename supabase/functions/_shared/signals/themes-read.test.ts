import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";

import { ModelError } from "./classify.ts";
import { ISSUE_THEMES } from "./themes.ts";
import {
  AnthropicThemeClient,
  costMicroUsd,
  parseThemes,
  renderThemeInput,
  THEMES_DETECTOR,
  THEMES_MAX_TOKENS,
  THEMES_SCHEMA,
  THEMES_SYSTEM_PROMPT,
  WORST_CALL_MICRO_USD,
} from "./themes-read.ts";

// A fake network: nothing leaves the process.

function client(answer: Record<string, unknown>, requests: Record<string, unknown>[] = []) {
  const fetchImpl = (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Promise.resolve(
      new Response(JSON.stringify(answer), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };
  return new AnthropicThemeClient("test-key", { fetch: fetchImpl as typeof fetch, maxRetries: 0 });
}

function message(text: string, stopReason = "end_turn") {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content: [{ type: "text", text }],
    stop_reason: stopReason,
    usage: { input_tokens: 900, output_tokens: 40 },
  };
}

const INPUT = { rating: 6, publicText: "The wifi kept dropping.", privateText: null };

Deno.test("the detector names the model and the prompt's version", () => {
  assertEquals(THEMES_DETECTOR, "claude-haiku-5-5@themes-v1");
});

Deno.test("the prompt describes every theme, and the schema allows no other", () => {
  for (const theme of ISSUE_THEMES) {
    assert(THEMES_SYSTEM_PROMPT.includes(`- ${theme}:`), theme);
  }
  const item = THEMES_SCHEMA.properties.complaints.items.properties;
  assertEquals(item.theme.enum, [...ISSUE_THEMES]);
});

Deno.test("the answer has no place for a quotation, a summary or a language", () => {
  assertEquals(Object.keys(THEMES_SCHEMA.properties), ["complaints"]);
  assertEquals(
    Object.keys(THEMES_SCHEMA.properties.complaints.items.properties),
    ["theme", "severity", "confidence"],
  );
});

Deno.test("what is sent is the rating and the text", () => {
  const rendered = renderThemeInput(INPUT);
  assert(rendered.startsWith("Overall rating: 6/10"));
  assert(rendered.includes("<public_review>\nThe wifi kept dropping.\n</public_review>"));
  assert(!rendered.includes("private_feedback"));
});

Deno.test("a review with no rating says so", () => {
  assert(renderThemeInput({ ...INPUT, rating: null }).startsWith("Overall rating: none"));
});

Deno.test("private feedback goes only when it was given", () => {
  const rendered = renderThemeInput({ ...INPUT, privateText: "Between us" });
  assert(rendered.includes("<private_feedback>\nBetween us\n</private_feedback>"));
});

Deno.test("an answer is read into labels", () => {
  const answer = parseThemes({
    complaints: [{ theme: "wifi", severity: "normal", confidence: 0.9 }],
  });
  assertEquals(answer, {
    labels: [{ theme: "wifi", severity: "normal", confidence: 0.9 }],
    invalid: 0,
  });
});

Deno.test("no complaint is an empty list", () => {
  assertEquals(parseThemes({ complaints: [] }), { labels: [], invalid: 0 });
});

Deno.test("an unknown theme costs itself, never the reading", () => {
  const answer = parseThemes({
    complaints: [
      { theme: "unicorns", severity: "normal", confidence: 0.9 },
      "not an object",
      { theme: "smell", severity: "normal", confidence: 0.7 },
    ],
  });
  assertEquals(answer.labels.map((label) => label.theme), ["smell"]);
  assertEquals(answer.invalid, 2);
});

Deno.test("a theme said twice is one label, the stronger", () => {
  const answer = parseThemes({
    complaints: [
      { theme: "wifi", severity: "low", confidence: 0.4 },
      { theme: "wifi", severity: "high", confidence: 0.8 },
    ],
  });
  assertEquals(answer.labels, [{ theme: "wifi", severity: "high", confidence: 0.8 }]);
});

Deno.test("confidence is held to 0–1 and a bad severity becomes normal", () => {
  const answer = parseThemes({
    complaints: [
      { theme: "wifi", severity: "odd", confidence: 7 },
      { theme: "smell", severity: "low", confidence: -1 },
      { theme: "tv", severity: "low", confidence: "very" },
    ],
  });
  assertEquals(answer.labels, [
    { theme: "wifi", severity: "normal", confidence: 1 },
    { theme: "smell", severity: "low", confidence: 0 },
    { theme: "tv", severity: "low", confidence: 0 },
  ]);
});

Deno.test("an answer that is no reading is the review's failure", () => {
  const error = assertThrows(() => parseThemes({ findings: [] }), ModelError);
  assertEquals((error as ModelError).scope, "review");
  assertThrows(() => parseThemes(null), ModelError);
});

Deno.test("a reading costs its tokens at the model's price", () => {
  assertEquals(costMicroUsd({ inputTokens: 1000, outputTokens: 100 }), 150);
  assertEquals(costMicroUsd({ inputTokens: 1, outputTokens: 0 }), 1);
});

Deno.test("the worst case books more than a whole answer and a long review", () => {
  assert(costMicroUsd({ inputTokens: 5000, outputTokens: THEMES_MAX_TOKENS }) <= WORST_CALL_MICRO_USD);
});

Deno.test("the client asks by schema within its tokens and reports what it cost", async () => {
  const requests: Record<string, unknown>[] = [];
  const reading = await client(message('{"complaints":[]}'), requests).read(INPUT);
  assertEquals(reading, { raw: { complaints: [] }, inputTokens: 900, outputTokens: 40 });
  assertEquals(requests[0].model, "claude-haiku-5-5");
  assertEquals(requests[0].max_tokens, THEMES_MAX_TOKENS);
  assertEquals(requests[0].system, THEMES_SYSTEM_PROMPT);
});

Deno.test("the client never retries behind the budget", async () => {
  let calls = 0;
  const fetchImpl = (): Promise<Response> => {
    calls += 1;
    return Promise.resolve(new Response("{}", { status: 500 }));
  };
  const plain = new AnthropicThemeClient("test-key", { fetch: fetchImpl as typeof fetch });
  await assertRejects(() => plain.read(INPUT), ModelError);
  assertEquals(calls, 1);
});

Deno.test("an answer that did not fit is the review's failure", async () => {
  const error = await assertRejects(
    () => client(message('{"complaints":[', "max_tokens")).read(INPUT),
    ModelError,
  );
  assertEquals((error as ModelError).code, "model_truncated");
  assertEquals((error as ModelError).scope, "review");
});

Deno.test("a refusal is the review's failure", async () => {
  const error = await assertRejects(() => client(message("", "refusal")).read(INPUT), ModelError);
  assertEquals((error as ModelError).code, "model_refused");
});

Deno.test("words instead of JSON are the review's failure", async () => {
  const error = await assertRejects(() => client(message("no")).read(INPUT), ModelError);
  assertEquals((error as ModelError).code, "model_bad_json");
});
