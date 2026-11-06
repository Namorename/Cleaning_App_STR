import { assert, assertAlmostEquals, assertEquals } from "jsr:@std/assert@1";

import {
  accuracyOf,
  agreementOf,
  bandOf,
  drawSample,
  pickForCheck,
  type ProbeRow,
  shuffled,
  summarize,
} from "./theme-probe.ts";

function row(n: number, over: Partial<ProbeRow> = {}): ProbeRow {
  return {
    n,
    reviewId: String(n),
    band: "low",
    month: "2026-05",
    channel: "airbnb",
    rating: 6,
    themes: [],
    ...over,
  };
}

Deno.test("reviews fall into three bands of rating", () => {
  assertEquals(bandOf(7), "low");
  assertEquals(bandOf(8), "mid");
  assertEquals(bandOf(9.5), "mid");
  assertEquals(bandOf(10), "high");
  assertEquals(bandOf(null), "mid");
});

Deno.test("a draw repeats itself and leaves the input alone", () => {
  const items = Array.from({ length: 50 }, (_, index) => index);
  assertEquals(shuffled(items, 1), shuffled(items, 1));
  assert(shuffled(items, 1).join() !== shuffled(items, 2).join());
  assertEquals(items[0], 0);
});

Deno.test("the sample takes each band up to its share", () => {
  const items = [
    ...Array.from({ length: 5 }, () => 6),
    ...Array.from({ length: 50 }, () => 9),
    ...Array.from({ length: 50 }, () => 10),
  ];
  const sample = drawSample(items, (rating) => rating, 10, 7);
  assertEquals(sample.filter((rating) => rating === 6).length, 5);
  assertEquals(sample.filter((rating) => rating === 9).length, 10);
  assertEquals(sample.filter((rating) => rating === 10).length, 10);
});

Deno.test("a check is mostly labelled reviews, a fifth silent ones", () => {
  const rows = Array.from({ length: 300 }, (_, index) =>
    row(index, { themes: index % 2 === 0 ? ["wifi"] : [] }));
  const picked = pickForCheck(rows, 100, 3);
  assertEquals(picked.length, 100);
  assertEquals(picked.filter((item) => item.themes.length === 0).length, 20);
});

Deno.test("a check takes what there is when labels are few", () => {
  const picked = pickForCheck([row(1, { themes: ["wifi"] }), row(2)], 100, 3);
  assertEquals(picked.length, 2);
});

Deno.test("coverage is weighted back by the bands' real sizes", () => {
  const rows = [
    row(1, { band: "low", themes: ["wifi"] }),
    row(2, { band: "high" }),
  ];
  const summary = summarize(rows, { low: 100, mid: 0, high: 900 });
  assertAlmostEquals(summary.coverageWeighted, 0.1);
});

Deno.test("a summary counts labels by theme and the share of other", () => {
  const summary = summarize(
    [row(1, { themes: ["wifi", "other"] }), row(2, { themes: ["wifi"] }), row(3, { themes: ["smell"] })],
    { low: 3, mid: 0, high: 0 },
  );
  assertEquals(summary.labels, 4);
  assertEquals(summary.byTheme.wifi, 2);
  assertEquals(summary.otherShare, 0.25);
  assertEquals(summary.byBand.low, { read: 3, withTheme: 3, labels: 4 });
});

Deno.test("a second reading counts as the same whatever the order", () => {
  const summary = summarize(
    [
      row(1, { themes: ["wifi", "smell"], themesAgain: ["smell", "wifi"] }),
      row(2, { themes: ["wifi"], themesAgain: [] }),
      row(3, { themes: ["wifi"] }),
    ],
    { low: 3, mid: 0, high: 0 },
  );
  assertEquals(summary.repeated, 2);
  assertEquals(summary.repeatedSame, 1);
});

Deno.test("an empty sample says nothing and breaks nothing", () => {
  const summary = summarize([], { low: 0, mid: 0, high: 0 });
  assertEquals(summary.coverageWeighted, 0);
  assertEquals(summary.otherShare, 0);
});

Deno.test("accuracy adds up right, wrong and missed", () => {
  const accuracy = accuracyOf(
    [
      { n: 1, right: ["wifi"], wrong: ["smell"], missed: [] },
      { n: 2, right: ["wifi", "wifi"], wrong: [], missed: ["tv"] },
    ],
    0,
  );
  assertEquals(accuracy.checked, 2);
  assertEquals(accuracy.labelsChecked, 4);
  assertEquals(accuracy.precision, 0.75);
  assertEquals(accuracy.recall, 0.75);
  assertEquals(accuracy.byTheme.tv, { right: 0, wrong: 0, missed: 1 });
});

Deno.test("it passes at 85 % on the frequent themes", () => {
  const right = (n: number) => Array.from({ length: n }, () => "wifi" as const);
  const pass = accuracyOf([{ n: 1, right: right(17), wrong: ["wifi", "wifi", "wifi"], missed: [] }], 0.05);
  assertEquals(pass.frequent[0].precision, 0.85);
  assertEquals(pass.passes, true);
  const fail = accuracyOf([{ n: 1, right: right(16), wrong: ["wifi", "wifi", "wifi", "wifi"], missed: [] }], 0.05);
  assertEquals(fail.passes, false);
});

Deno.test("a rare theme cannot fail the probe alone", () => {
  const accuracy = accuracyOf(
    [{ n: 1, right: ["wifi", "wifi", "wifi", "wifi", "wifi"], wrong: ["smell"], missed: [] }],
    0,
  );
  assertEquals(accuracy.frequent.map((one) => one.theme), ["wifi"]);
  assertEquals(accuracy.passes, true);
});

Deno.test("too much other fails the probe", () => {
  assertEquals(accuracyOf([{ n: 1, right: ["wifi"], wrong: [], missed: [] }], 0.11).passes, false);
});

Deno.test("agreement counts themes in common, one side only, and whole sets", () => {
  const result = agreementOf([
    { n: 1, band: "low", language: "en", working: ["wifi", "smell"], reference: ["wifi"] },
    { n: 2, band: "low", language: "cs", working: ["wifi"], reference: ["wifi", "tv"] },
    { n: 3, band: "high", language: "en", working: [], reference: [] },
    { n: 4, band: "high", language: "en", working: [], reference: ["tv"] },
  ], { low: 1, mid: 0, high: 3 });
  assertEquals(result.overall.both, 2);
  assertEquals(result.overall.onlyWorking, 1);
  assertEquals(result.overall.onlyReference, 2);
  assertEquals(result.overall.sameSet, 1);
  assertEquals(result.overall.sameVerdict, 3);
  assertEquals(result.byTheme.wifi.precision, 1);
  assertEquals(result.byTheme.tv.recall, 0);
  assertEquals(result.byBand.high.reviews, 2);
  assertEquals(result.byLanguage.cs.reviews, 1);
  assertAlmostEquals(result.weighted.sameSet, 0.375);
});

const agreed = (n: number, working: ProbeRow["themes"], reference: ProbeRow["themes"]) =>
  ({ n, band: "low" as const, language: "en", working, reference });
const manyAgreed = (count: number) => Array.from({ length: count }, (_, n) => agreed(n, ["wifi"], ["wifi"]));
const lowOnly = { low: 1, mid: 0, high: 0 };

Deno.test("agreement holds at the owner's thresholds, and a rare theme cannot fail it", () => {
  const result = agreementOf([...manyAgreed(30), agreed(90, ["wifi", "smell"], ["wifi"])], lowOnly);
  assertEquals(result.passes, true);
});

Deno.test("a frequent theme under 70 % fails the agreement though the whole is fine", () => {
  const hit = Array.from({ length: 7 }, (_, n) => agreed(100 + n, ["wifi", "tv"], ["wifi", "tv"]));
  const missed = Array.from({ length: 5 }, (_, n) => agreed(200 + n, ["wifi"], ["wifi", "tv"]));
  const result = agreementOf([...manyAgreed(40), ...hit, ...missed], lowOnly);
  assertEquals(result.low.map((one) => one.theme), ["tv"]);
  assertEquals(result.passes, false);
});

Deno.test("a frequent theme at 75 % no longer fails the agreement", () => {
  const hit = Array.from({ length: 9 }, (_, n) => agreed(100 + n, ["wifi", "tv"], ["wifi", "tv"]));
  const extra = Array.from({ length: 3 }, (_, n) => agreed(200 + n, ["wifi", "tv"], ["wifi"]));
  const reference = Array.from({ length: 1 }, (_, n) => agreed(300 + n, ["wifi"], ["wifi", "tv"]));
  const result = agreementOf([...manyAgreed(40), ...hit, ...extra, ...reference], lowOnly);
  assertEquals(result.byTheme.tv.precision, 0.75);
  assertEquals(result.passes, true);
});

Deno.test("complaints found by one reader alone fail the agreement", () => {
  const silent = Array.from({ length: 6 }, (_, n) => agreed(100 + n, [], ["other"]));
  const result = agreementOf([...manyAgreed(94), ...silent], lowOnly);
  assertEquals(result.overall.recall !== null && result.overall.recall >= 0.85, true);
  assertEquals(result.passes, false);
});

Deno.test("whole sets matching too rarely fail the agreement", () => {
  const five: ProbeRow["themes"] = ["wifi", "tv", "smell", "cleanliness", "parking"];
  const same = Array.from({ length: 75 }, (_, n) => agreed(n, five, five));
  const extra = Array.from({ length: 25 }, (_, n) => agreed(100 + n, [...five, "pests"], five));
  const result = agreementOf([...same, ...extra], lowOnly);
  assertEquals(result.overall.precision !== null && result.overall.precision >= 0.85, true);
  assertEquals(result.weighted.sameSet, 0.75);
  assertEquals(result.passes, false);
});

Deno.test("nothing checked passes nothing", () => {
  assertEquals(accuracyOf([], 0).passes, false);
});
