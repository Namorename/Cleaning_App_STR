import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";

import {
  AnthropicModelClient,
  MODEL_ID,
  type ModelInput,
  ModelError,
  parseReading,
} from "./classify.ts";
import { readByRules, RULES_CONFIDENCE } from "./rules.ts";
import type { ReviewTexts } from "./types.ts";

// Synthetic review texts only, in the four languages the dictionary knows.

function texts(publicText: string | null, privateText: string | null = null): ReviewTexts {
  return { publicText, privateText, categoryComments: {} };
}

Deno.test("the rules find a failure next to its thing, in en, de, cs and ru", () => {
  const cases: Array<[string, string, string]> = [
    ["The shower had no hot water for two days.", "repair", "hot_water"],
    ["Leider war keine Heizung in der Wohnung.", "repair", "heating"],
    ["Wasserhahn in der Küche ist kaputt.", "repair", "plumbing_leak"],
    ["Nefungovala lednice, jinak dobré.", "repair", "appliance"],
    ["В ванной течёт кран.", "repair", "plumbing_leak"],
    ["The Wi-Fi did not work at all.", "repair", "internet_tv"],
    ["We could not get in, the code did not work.", "access", "lock_door"],
    ["There was a gas smell in the kitchen.", "safety", "other"],
    ["Cockroaches in the bathroom.", "pests", "other"],
  ];
  for (const [text, kind, subject] of cases) {
    const found = readByRules(texts(text));
    assert(
      found.some((f) => f.kind === kind && f.subject === subject),
      `${text} → ${JSON.stringify(found.map((f) => `${f.kind}/${f.subject}`))}`,
    );
  }
});

Deno.test("the rules hear a negation, and praise is no complaint", () => {
  assertEquals(readByRules(texts("Nothing was broken, the heating worked perfectly.")), []);
  assertEquals(readByRules(texts("Restaurants nearby were great, the flat was lovely.")), []);
  assertEquals(readByRules(texts("Alles war super, nichts kaputt.")), []);
});

Deno.test("a rules card has no words, its fragment from the text, and waits for a manager", () => {
  const [card] = readByRules(texts(null, "Private note: the toilet is clogged again."));
  assertEquals(card.kind, "repair");
  assertEquals(card.subject, "drain_toilet");
  assertEquals(card.summary_i18n, {});
  assertEquals(card.evidence_source, "private");
  assertEquals(card.confidence, RULES_CONFIDENCE);
  assertStringIncludes("Private note: the toilet is clogged again.", card.evidence as string);
});

Deno.test("a bare failure word takes the thing named near it, and adds no second card for one complaint", () => {
  const near = (text: string) => readByRules(texts(text)).map((f) => `${f.kind}/${f.subject}`);
  assertEquals(near("No hot water, and the shower was broken too."), ["repair/hot_water"]);
  assertEquals(near("The heating is broken."), ["repair/heating"]);
  assertEquals(near("Something in the hall was broken."), ["repair/other"]);
});

const INPUT: ModelInput = {
  channel: "airbnb",
  departureMonth: "2026-10",
  placeKind: "flat",
  rating: 6,
  categoryRatings: { cleanliness: 9 },
  texts: texts("The kettle did not work and [STAFF] could not fix it."),
};

function item(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "repair",
    subject: "appliance",
    urgency: "normal",
    still_relevant: "likely",
    summary_i18n: { en: "Kettle does not work", cs: "Nefunguje konvice", ru: "Не работает чайник" },
    evidence: "The kettle did not work",
    evidence_source: "public",
    confidence: 0.9,
    ...overrides,
  };
}

Deno.test("the model's answer is checked: made-up evidence, names and unknown kinds cost only themselves", () => {
  const reading = parseReading(
    {
      language: "EN",
      findings: [
        item(),
        item({ evidence: "The oven exploded" }),
        item({ summary_i18n: { en: "Ask [STAFF] about the kettle", cs: "x", ru: "x" } }),
        item({ summary_i18n: { en: "Olga says the kettle is broken", cs: "x", ru: "x" } }),
        item({ kind: "plumbing" }),
        item({ subject: "kettle", confidence: 7, summary_i18n: { en: "Kettle broken" } }),
      ],
    },
    INPUT,
    ["Olga"],
  );

  assertEquals(reading.language, "en");
  assertEquals(reading.invalid, 4);
  assertEquals(reading.findings.length, 2);
  assertEquals(reading.findings[1].subject, "other");
  assertEquals(reading.findings[1].confidence, 1);
  assertEquals(reading.findings[1].summary_i18n, { en: "Kettle broken" });
});

Deno.test("an answer that is not a reading is the review's failure", () => {
  let error: unknown = null;
  try {
    parseReading({ nothing: true }, INPUT, []);
  } catch (caught: unknown) {
    error = caught;
  }
  assert(error instanceof ModelError);
  assertEquals(error.code, "model_bad_shape");
  assertEquals(error.scope, "review");
});

interface Recorded {
  readonly body: Record<string, unknown>;
  readonly hasKey: boolean;
}

/** The Messages API on a fake network: answers planned, requests recorded. */
function fakeApi(answers: Array<{ status: number; body: unknown }>): {
  fetch: typeof fetch;
  requests: Recorded[];
} {
  const requests: Recorded[] = [];
  const fakeFetch = async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers ?? {});
    requests.push({
      body: JSON.parse(String(init?.body ?? "{}")),
      hasKey: headers.get("x-api-key") === "sk-test",
    });
    const next = answers.shift() ?? { status: 500, body: {} };
    return await Promise.resolve(
      new Response(JSON.stringify(next.body), {
        status: next.status,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  return { fetch: fakeFetch as typeof fetch, requests };
}

function message(text: string, stopReason = "end_turn"): unknown {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: MODEL_ID,
    content: [{ type: "text", text }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 20 },
  };
}

Deno.test("the real client asks Haiku 5.5 for JSON by schema and hands the answer back", async () => {
  const api = fakeApi([{ status: 200, body: message(JSON.stringify({ language: "en", findings: [item()] })) }]);
  const client = new AnthropicModelClient("sk-test", { fetch: api.fetch, maxRetries: 0 });

  const raw = await client.read(INPUT);

  assertEquals(parseReading(raw, INPUT, []).findings.length, 1);
  const [request] = api.requests;
  assert(request.hasKey);
  assertEquals(request.body.model, "claude-haiku-5-5");
  const config = request.body.output_config as { effort: string; format: { type: string } };
  assertEquals(config.effort, "low");
  assertEquals(config.format.type, "json_schema");
  assert(!("temperature" in request.body), "Haiku 5.5 refuses sampling parameters");
  const sent = JSON.stringify(request.body.messages);
  assertStringIncludes(sent, "The kettle did not work");
  assert(!sent.includes("Synthetic"), "a name went to the model");
});

Deno.test("the client says whose a failure is: a refused key and an overload are the service's", async () => {
  const cases: Array<[number, string, string]> = [
    [401, "service_key_rejected", "service"],
    [429, "service_rate_limited", "service"],
    [529, "service_overloaded", "service"],
    [500, "model_server_error", "unknown"],
    [400, "model_bad_request", "unknown"],
  ];
  for (const [status, code, scope] of cases) {
    const api = fakeApi([{ status, body: { type: "error", error: { type: "x", message: "x" } } }]);
    const client = new AnthropicModelClient("sk-test", { fetch: api.fetch, maxRetries: 0 });
    const error = await assertRejects(() => client.read(INPUT), ModelError);
    assertEquals([error.code, error.scope], [code, scope], `HTTP ${status}`);
  }
});

Deno.test("an answer that does not parse or did not fit is the review's", async () => {
  for (const [body, code] of [
    [message("not json"), "model_bad_json"],
    [message("{\"language\":", "max_tokens"), "model_truncated"],
    [message("", "refusal"), "model_refused"],
  ] as const) {
    const api = fakeApi([{ status: 200, body }]);
    const client = new AnthropicModelClient("sk-test", { fetch: api.fetch, maxRetries: 0 });
    const error = await assertRejects(() => client.read(INPUT), ModelError);
    assertEquals([error.code, error.scope], [code, "review"]);
  }
});
