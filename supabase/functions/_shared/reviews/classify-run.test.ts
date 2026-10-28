import { assert, assertEquals } from "jsr:@std/assert@1";

import { MODEL_DETECTOR, type ModelClient, ModelError } from "./classify.ts";
import { type QueuedReview, type ReviewClassifyStore, runReviewClassify } from "./classify-run.ts";
import { RULES_DETECTOR } from "./rules.ts";
import type { ReviewSettings } from "./types.ts";

// Synthetic reviews and a fake of the database; nothing leaves the process.

const SETTINGS: ReviewSettings = {
  sync_enabled: true,
  texts_enabled: true,
  tasks_enabled: false,
  model_enabled: true,
  model_since: "2026-10-01T06:00:00Z",
  daily_model_cap: 50,
  notice_published_at: "2026-09-01T00:00:00Z",
};

function queued(id: string, overrides: Partial<QueuedReview> = {}): QueuedReview {
  return {
    id,
    channel: "booking",
    departure_date: "2026-10-12",
    room_id: null,
    rating: 5,
    category_ratings: {},
    public_text: "The fridge was broken.",
    private_text: null,
    category_comments: null,
    rules_version: null,
    analysed_at: null,
    analysis_attempts: 0,
    submitted_at: "2026-10-14T09:00:00Z",
    ...overrides,
  };
}

function classifyStore(queue: QueuedReview[], settings: ReviewSettings = SETTINGS, granted = 50) {
  const applied: Array<[string, string]> = [];
  const failed: Array<[string, string]> = [];
  const logs: Array<{ isOk: boolean; counts: Readonly<Record<string, number>> }> = [];
  let wantedSeen = 0;
  const sinceAsked: Array<string | null> = [];
  const store: ReviewClassifyStore = {
    settings: () => Promise.resolve(settings),
    queue: (_limit, modelSince) => {
      sinceAsked.push(modelSince);
      return Promise.resolve(queue);
    },
    reserveCalls: (wanted) => {
      wantedSeen = wanted;
      return Promise.resolve(Math.min(wanted, granted));
    },
    apply: (id, detector) => {
      applied.push([id, detector]);
      return Promise.resolve({ candidate: 1 });
    },
    markFailed: (id, code) => {
      failed.push([id, code]);
      return Promise.resolve();
    },
    forbiddenWords: () => Promise.resolve(["Olga"]),
    log: (isOk, counts) => {
      logs.push({ isOk, counts });
      return Promise.resolve();
    },
  };
  return { store, applied, failed, logs, sinceAsked, wanted: () => wantedSeen };
}

const GOOD_ANSWER = {
  language: "en",
  findings: [{
    kind: "repair",
    subject: "appliance",
    urgency: "normal",
    still_relevant: "likely",
    summary_i18n: { en: "Fridge is broken", cs: "Rozbitá lednice", ru: "Сломан холодильник" },
    evidence: "The fridge was broken",
    evidence_source: "public",
    confidence: 0.9,
  }],
};

/** A model that answers from a script, one entry a call: an answer, or an error to throw. */
function scriptedModel(script: Array<unknown | ModelError>): ModelClient & { calls: number } {
  const model = {
    calls: 0,
    read(): Promise<unknown> {
      const next = script[model.calls];
      model.calls += 1;
      return next instanceof ModelError ? Promise.reject(next) : Promise.resolve(next);
    },
  };
  return model;
}

Deno.test("the model reads first, the rules after, each review once", async () => {
  const run = classifyStore([queued("a"), queued("b", { rules_version: RULES_DETECTOR })]);
  const model = scriptedModel([GOOD_ANSWER, GOOD_ANSWER]);
  const summary = await runReviewClassify({ store: run.store, model });

  assertEquals(run.applied, [["a", MODEL_DETECTOR], ["a", RULES_DETECTOR], ["b", MODEL_DETECTOR]]);
  assertEquals(summary.modelCalls, 2);
  assertEquals(run.logs[0].isOk, true);
});

Deno.test("no key, or the model off: the rules read alone, no call is booked", async () => {
  for (const [settings, model] of [
    [SETTINGS, null],
    [{ ...SETTINGS, model_enabled: false }, scriptedModel([GOOD_ANSWER])],
  ] as const) {
    const run = classifyStore([queued("a")], settings);
    await runReviewClassify({ store: run.store, model });
    assertEquals(run.applied, [["a", RULES_DETECTOR]]);
    assertEquals(run.wanted(), 0);
  }
});

Deno.test("the model reads back to model_since and no further: an older text keeps the rules' reading", async () => {
  const run = classifyStore([
    queued("fresh"),
    queued("old", { submitted_at: "2026-09-20T09:00:00Z" }),
  ]);
  const model = scriptedModel([GOOD_ANSWER, GOOD_ANSWER]);
  const summary = await runReviewClassify({ store: run.store, model });

  assertEquals(run.sinceAsked, [SETTINGS.model_since]);
  assertEquals(run.wanted(), 1);
  assertEquals(model.calls, 1);
  assertEquals(run.applied, [["fresh", MODEL_DETECTOR], ["fresh", RULES_DETECTOR], ["old", RULES_DETECTOR]]);
  assertEquals(summary.modelRead, 1);
});

Deno.test("with the model off the queue is asked for the rules' reviews only", async () => {
  const run = classifyStore([queued("a")], { ...SETTINGS, model_enabled: false });
  await runReviewClassify({ store: run.store, model: scriptedModel([GOOD_ANSWER]) });
  assertEquals(run.sinceAsked, [null]);
});

Deno.test("texts off: nothing to read", async () => {
  const run = classifyStore([queued("a")], { ...SETTINGS, texts_enabled: false });
  const summary = await runReviewClassify({ store: run.store, model: scriptedModel([]) });
  assertEquals(summary.status, "off");
  assertEquals(run.applied, []);
});

Deno.test("the ceiling holds: calls beyond the booked ones are not made", async () => {
  const run = classifyStore([queued("a"), queued("b"), queued("c")], SETTINGS, 1);
  const model = scriptedModel([GOOD_ANSWER, GOOD_ANSWER, GOOD_ANSWER]);
  await runReviewClassify({ store: run.store, model });
  assertEquals(model.calls, 1);
  assertEquals(run.applied.filter(([, d]) => d === MODEL_DETECTOR).length, 1);
  assertEquals(run.applied.filter(([, d]) => d === RULES_DETECTOR).length, 3);
});

Deno.test("a refused key is the service's: the model stops, no attempt is spent, the rules go on", async () => {
  const run = classifyStore([queued("a"), queued("b")]);
  const model = scriptedModel([new ModelError("service_key_rejected", "service", "x")]);
  const summary = await runReviewClassify({ store: run.store, model });

  assertEquals(model.calls, 1);
  assertEquals(run.failed, [["a", "service_key_rejected"]]);
  assertEquals(run.applied, [["a", RULES_DETECTOR], ["b", RULES_DETECTOR]]);
  assertEquals(summary.stoppedModel, "service_key_rejected");
  assertEquals(run.logs[0].isOk, false);
});

Deno.test("an unknown failure, then a success: the first review's own, and it spends an attempt", async () => {
  const run = classifyStore([queued("a"), queued("b")]);
  const model = scriptedModel([new ModelError("model_timeout", "unknown", "x"), GOOD_ANSWER]);
  await runReviewClassify({ store: run.store, model });
  assertEquals(run.failed, [["a", "model_timeout"]]);
});

Deno.test("an unknown failure twice on two reviews: the service's, both spared, the model stops", async () => {
  const run = classifyStore([queued("a"), queued("b"), queued("c")]);
  const model = scriptedModel([
    new ModelError("model_bad_request", "unknown", "x"),
    new ModelError("model_bad_request", "unknown", "x"),
  ]);
  const summary = await runReviewClassify({ store: run.store, model });
  assertEquals(model.calls, 2);
  assertEquals(run.failed, [["b", "service_unavailable"], ["a", "service_unavailable"]]);
  assertEquals(summary.stoppedModel, "model_bad_request");
});

Deno.test("an answer that does not parse is the review's: an attempt spent, the next one read", async () => {
  const run = classifyStore([queued("a"), queued("b")]);
  const model = scriptedModel([{ garbage: true }, GOOD_ANSWER]);
  await runReviewClassify({ store: run.store, model });
  assertEquals(run.failed, [["a", "model_bad_shape"]]);
  assert(run.applied.some(([id, d]) => id === "b" && d === MODEL_DETECTOR));
});
