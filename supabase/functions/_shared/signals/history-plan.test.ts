import { assertEquals } from "jsr:@std/assert@1";

import {
  floorOf,
  historyFrom,
  mondayOf,
  monthStart,
  nextStayMonth,
  planHistory,
  windowOf,
} from "./history-plan.ts";

const TODAY = "2026-11-06";
const LINE = "2026-11-04";

Deno.test("the window is calendar months with the present one", () => {
  assertEquals(historyFrom(TODAY, 12), "2025-12-01");
  assertEquals(historyFrom(TODAY, 3), "2026-09-01");
  assertEquals(historyFrom(TODAY, 1), "2026-11-01");
});

Deno.test("a month back crosses a new year and a short month", () => {
  assertEquals(monthStart("2026-03-31", 1), "2026-02-01");
  assertEquals(monthStart("2026-01-15", 2), "2025-11-01");
});

Deno.test("a week starts on its Monday", () => {
  assertEquals(mondayOf("2026-11-06"), "2026-11-02");
  assertEquals(mondayOf("2026-11-02"), "2026-11-02");
  assertEquals(mondayOf("2026-11-01"), "2026-10-26");
});

Deno.test("twelve months up to the line are 49 weeks", () => {
  const plan = planHistory({ today: TODAY, depthMonths: 12, line: LINE, done: [] });
  assertEquals(plan.from, "2025-12-01");
  assertEquals(plan.weeksTotal, 49);
  assertEquals(plan.weeksLeft, 49);
});

Deno.test("the newest week that has settled for 30 days comes first", () => {
  const plan = planHistory({ today: TODAY, depthMonths: 12, line: LINE, done: [] });
  assertEquals(plan.next, { start: "2026-09-28", end: "2026-10-04" });
});

Deno.test("a closed week is not read again, the one before it is next", () => {
  const plan = planHistory({ today: TODAY, depthMonths: 12, line: LINE, done: ["2026-09-28"] });
  assertEquals(plan.next?.start, "2026-09-21");
  assertEquals(plan.weeksLeft, 48);
});

Deno.test("a closed week of another depth still counts as closed", () => {
  const plan = planHistory({ today: TODAY, depthMonths: 1, line: LINE, done: ["2020-01-06"] });
  assertEquals(plan.weeksLeft, plan.weeksTotal);
});

Deno.test("nothing settled yet leaves the weeks open and nothing next", () => {
  const plan = planHistory({ today: "2026-11-06", depthMonths: 1, line: LINE, done: [] });
  assertEquals(plan.next, null);
  assertEquals(plan.weeksLeft > 0, true);
});

Deno.test("a settled week becomes readable by itself as the days pass", () => {
  const plan = planHistory({ today: "2026-12-04", depthMonths: 12, line: LINE, done: [] });
  assertEquals(plan.next, { start: "2026-10-26", end: "2026-11-01" });
});

Deno.test("no week starts at the line or after it", () => {
  const plan = planHistory({ today: "2026-12-20", depthMonths: 12, line: LINE, done: [] });
  assertEquals(plan.next?.start, "2026-11-02");
});

Deno.test("without a line the weeks run up to today", () => {
  const plan = planHistory({ today: TODAY, depthMonths: 1, line: null, done: [] });
  assertEquals(plan.weeksTotal, 2);
  assertEquals(plan.next, null);
});

Deno.test("the months are the window's, newest first", () => {
  const plan = planHistory({ today: TODAY, depthMonths: 3, line: LINE, done: [] });
  assertEquals(plan.months, [
    { start: "2026-11-01", end: "2026-11-30" },
    { start: "2026-10-01", end: "2026-10-31" },
    { start: "2026-09-01", end: "2026-09-30" },
  ]);
});

Deno.test("a month never read comes before anything else", () => {
  const { months } = planHistory({ today: TODAY, depthMonths: 3, line: LINE, done: [] });
  assertEquals(nextStayMonth(months, {}, TODAY)?.start, "2026-11-01");
  assertEquals(
    nextStayMonth(months, { "2026-11-01": `${TODAY}T07:00:00Z` }, TODAY)?.start,
    "2026-10-01",
  );
});

Deno.test("the present month and the one before are read again once a day", () => {
  const { months } = planHistory({ today: TODAY, depthMonths: 3, line: LINE, done: [] });
  const today = `${TODAY}T07:00:00Z`;
  const yesterday = "2026-11-05T07:00:00Z";
  assertEquals(
    nextStayMonth(months, { "2026-11-01": today, "2026-10-01": yesterday, "2026-09-01": yesterday }, TODAY)
      ?.start,
    "2026-10-01",
  );
  assertEquals(
    nextStayMonth(months, { "2026-11-01": today, "2026-10-01": today, "2026-09-01": yesterday }, TODAY),
    null,
  );
});

Deno.test("a listing younger than the window starts at its birth", () => {
  assertEquals(floorOf("2025-12-01", "2026-03-15"), "2026-03-15");
});

Deno.test("an older listing and one the PMS cannot date start with the window", () => {
  assertEquals(floorOf("2025-12-01", "2022-01-20"), "2025-12-01");
  assertEquals(floorOf("2025-12-01", null), "2025-12-01");
  assertEquals(floorOf("2025-12-01", undefined), "2025-12-01");
});

Deno.test("a window ends the moment after its last day", () => {
  const { since, until } = windowOf({ start: "2026-09-28", end: "2026-10-04" });
  assertEquals(since.toISOString(), "2026-09-28T00:00:00.000Z");
  assertEquals(until.toISOString(), "2026-10-05T00:00:00.000Z");
});
