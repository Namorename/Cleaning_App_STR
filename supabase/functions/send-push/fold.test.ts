import { assertEquals } from "jsr:@std/assert@1";

import type { PushGroup, PushKind, PushRow } from "./batch.ts";
import { fold } from "./fold.ts";

/**
 * One push for a group of changes to one cleaning or one thread
 * (docs/f11-plan.md, «М3 — проект перед кодом», «Свёртка»). The group is
 * handed out once its last row is due, so a burst of edits becomes one push
 * that says where things ended up — or nothing, when they ended up where they
 * started.
 */

const TASK = "3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b";

let nextId = 1;
function row(kind: PushKind, params: Record<string, unknown> = {}, urgent = false): PushRow {
  return {
    id: nextId++,
    kind,
    taskId: TASK,
    threadId: null,
    propertyId: "900001",
    params: { type: "cleaning", ...params },
    urgent,
  };
}

function group(rows: PushRow[], collapseKey = `task:${TASK}`): PushGroup {
  return {
    recipientId: "a1b2c3d4-1111-4111-8111-a1b2c3d40001",
    collapseKey,
    language: "ru",
    tokens: [{ token: "ExponentPushToken[x]", platform: "ios" }],
    places: new Map(),
    muted: new Set(),
    lease: null,
    rows,
  };
}

Deno.test("one change is sent as it is", () => {
  const folded = fold(group([row("cleaning_assigned", { date: "2026-10-02" })]));

  assertEquals(folded, {
    type: "task",
    event: "cleaning_assigned",
    taskId: TASK,
    jobType: "cleaning",
    date: "2026-10-02",
    propertyId: "900001",
    urgent: false,
  });
});

Deno.test("given and taken back before she heard of it: nothing is sent", () => {
  assertEquals(
    fold(group([
      row("cleaning_assigned", { date: "2026-10-02" }),
      row("cleaning_unassigned", { date: "2026-10-02" }),
    ])),
    null,
  );
  assertEquals(
    fold(group([
      row("cleaning_new", { date: "2026-10-02" }),
      row("cleaning_cancelled", { date: "2026-10-02" }),
    ])),
    null,
  );
});

Deno.test("taken from her with nothing given first: the last word is sent", () => {
  const folded = fold(group([
    row("cleaning_moved", { from_date: "2026-10-02", to_date: "2026-10-03", by: "office" }),
    row("cleaning_cancelled", { date: "2026-10-03" }, true),
  ]));

  assertEquals(folded?.type === "task" ? [folded.event, folded.date, folded.urgent] : null, [
    "cleaning_cancelled",
    "2026-10-03",
    true,
  ]);
});

Deno.test("given and then moved: one assignment, on the day it ended up on", () => {
  const folded = fold(group([
    row("cleaning_assigned", { date: "2026-10-02" }),
    row("cleaning_moved", {
      from_date: "2026-10-02",
      to_date: "2026-10-04",
      from_property: 900001,
      to_property: 900001,
      by: "booking",
    }),
  ]));

  assertEquals(folded?.type === "task" ? [folded.event, folded.date] : null, [
    "cleaning_assigned",
    "2026-10-04",
  ]);
});

Deno.test("moved twice: one move, from where it was to where it is", () => {
  const folded = fold(group([
    row("cleaning_moved", {
      from_date: "2026-10-02",
      to_date: "2026-10-03",
      from_property: 900001,
      to_property: 900001,
      by: "booking",
    }),
    row("cleaning_moved", {
      from_date: "2026-10-03",
      to_date: "2026-10-05",
      from_property: 900001,
      to_property: 900002,
      by: "office",
    }, true),
  ]));

  assertEquals(folded, {
    type: "task",
    event: "cleaning_moved",
    taskId: TASK,
    jobType: "cleaning",
    date: "2026-10-05",
    propertyId: "900001",
    urgent: true,
    move: {
      fromDate: "2026-10-02",
      toDate: "2026-10-05",
      fromPropertyId: "900001",
      toPropertyId: "900002",
      by: "office",
    },
  });
});

Deno.test("moved away and back again: nothing is sent", () => {
  assertEquals(
    fold(group([
      row("cleaning_moved", {
        from_date: "2026-10-02",
        to_date: "2026-10-03",
        from_property: 900001,
        to_property: 900001,
        by: "booking",
      }),
      row("cleaning_moved", {
        from_date: "2026-10-03",
        to_date: "2026-10-02",
        from_property: 900001,
        to_property: 900001,
        by: "booking",
      }),
    ])),
    null,
  );
});

Deno.test("only the hours changed: the last hours are sent", () => {
  const folded = fold(group([
    row("cleaning_window", { date: "2026-10-02", time_from: "10:00:00", time_to: "14:00:00" }),
    row("cleaning_window", { date: "2026-10-02", time_from: "11:00:00", time_to: "15:00:00" }),
  ]));

  assertEquals(folded?.type === "task" ? folded.window : null, { from: "11:00", to: "15:00" });
});

Deno.test("a booking cancelled while she cleans is always said", () => {
  const folded = fold(group([row("booking_cancelled_live", { date: "2026-10-02" }, true)]));

  assertEquals(folded?.type === "task" ? [folded.event, folded.urgent] : null, [
    "booking_cancelled_live",
    true,
  ]);
});

Deno.test("free work is offered as it is", () => {
  const folded = fold(group([row("cleaning_free", { date: "2026-10-03" })]));

  assertEquals(folded?.type === "task" ? folded.event : null, "cleaning_free");
});

Deno.test("a repair keeps its kind of job, so it is not called a cleaning", () => {
  const folded = fold(group([row("cleaning_assigned", { date: "2026-10-02", type: "maintenance" })]));

  assertEquals(folded?.type === "task" ? folded.jobType : null, "maintenance");
});

Deno.test("several messages in one thread: one push that counts them and names the last author", () => {
  const thread = "5b6d4e8f-9a0b-4c2d-8e4f-5a6b3f2a1c4e";
  const message = (author: string): PushRow => ({
    id: nextId++,
    kind: "chat_message",
    taskId: TASK,
    threadId: thread,
    propertyId: "900001",
    params: { subject: "task", task_id: TASK, problem_id: null, author_name: author },
    urgent: false,
  });

  const folded = fold(group([message("Bara"), message("Office"), message("Anna")], `thread:${thread}`));

  assertEquals(folded, {
    type: "chat",
    count: 3,
    author: "Anna",
    subject: "task",
    subjectId: TASK,
    threadId: thread,
    propertyId: "900001",
  });
});

Deno.test("a message about a report opens the report's thread", () => {
  const problem = "9a0b1c2d-3e4f-4a5b-8f2a-1c4e5b6d4e8f";
  const folded = fold(group([{
    id: nextId++,
    kind: "chat_message",
    taskId: null,
    threadId: "t",
    propertyId: "900003",
    params: { subject: "problem", task_id: null, problem_id: problem, author_name: "Tomas" },
    urgent: false,
  }], "thread:t"));

  assertEquals(folded?.type === "chat" ? [folded.subject, folded.subjectId] : null, [
    "problem",
    problem,
  ]);
});

Deno.test("the morning summary says what is hers today, what came into her week and what is free", () => {
  const folded = fold(group([{
    id: nextId++,
    kind: "daily_digest",
    taskId: null,
    threadId: null,
    propertyId: null,
    params: { date: "2026-10-02", today: 2, new_in_week: 1, free: 3 },
    urgent: false,
  }], "digest:2026-10-02"));

  assertEquals(folded, { type: "digest", today: 2, newInWeek: 1, free: 3 });
});

Deno.test("a summary queued before free work was counted says nothing of it", () => {
  const folded = fold(group([{
    id: nextId++,
    kind: "daily_digest",
    taskId: null,
    threadId: null,
    propertyId: null,
    params: { date: "2026-10-02", today: 2, new_in_week: 0 },
    urgent: false,
  }], "digest:2026-10-02"));

  assertEquals(folded, { type: "digest", today: 2, newInWeek: 0, free: 0 });
});

Deno.test("taken off her and left free: she hears it was taken, not that it is free", () => {
  // Free work is an offer to whoever may take it; to the one the same group
  // says held it, her own holding is the news — whatever order the rows came in.
  const folded = fold(group([
    row("cleaning_unassigned", { date: "2026-10-02" }, true),
    row("cleaning_free", { date: "2026-10-02" }),
  ]));

  assertEquals(folded?.type === "task" ? folded.event : null, "cleaning_unassigned");
});

Deno.test("given, taken away and left free inside one minute: nothing", () => {
  const folded = fold(group([
    row("cleaning_assigned", { date: "2026-10-02" }),
    row("cleaning_unassigned", { date: "2026-10-02" }),
    row("cleaning_free", { date: "2026-10-02" }),
  ]));

  assertEquals(folded, null);
});

const PROBLEM = "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";

function reported(params: Record<string, unknown>, urgent = false): PushRow {
  return {
    id: nextId++,
    kind: "problem_new",
    taskId: null,
    threadId: null,
    propertyId: "900001",
    params: { problem_id: PROBLEM, priority: "normal", property: 900001, ...params },
    urgent,
  };
}

Deno.test("a new task is one push about the task: where, who reported it, how urgent", () => {
  const folded = fold(group([reported({ reporter_name: "Anna" })], `problem:${PROBLEM}`));

  assertEquals(folded, {
    type: "problem",
    problemId: PROBLEM,
    propertyId: "900001",
    reporter: "Anna",
    urgent: false,
  });
});

Deno.test("a new task of high priority stays urgent", () => {
  const folded = fold(group(
    [reported({ priority: "high", reporter_name: "Anna" }, true)],
    `problem:${PROBLEM}`,
  ));

  assertEquals(folded?.type === "problem" ? folded.urgent : null, true);
});

Deno.test("a new task that does not say which it is folds into nothing", () => {
  assertEquals(fold(group([reported({ problem_id: null })], `problem:${PROBLEM}`)), null);
});

// ---------- a cleaning handed back, for the office (20261118120000) ----------

Deno.test("a decline tells the office who, the day and the cleaning", () => {
  const folded = fold(
    group([row("cleaning_declined", { date: "2026-11-18", by: "x", by_name: "Вера" }, true)]),
  );

  assertEquals(folded, {
    type: "task",
    event: "cleaning_declined",
    taskId: TASK,
    jobType: "cleaning",
    date: "2026-11-18",
    propertyId: "900001",
    urgent: true,
    person: "Вера",
  });
});

Deno.test("an interrupt is said as an interrupt, her name or none", () => {
  const folded = fold(group([row("cleaning_interrupted", { date: "2026-11-18" })]));

  assertEquals(folded?.type === "task" ? [folded.event, folded.person] : null, [
    "cleaning_interrupted",
    null,
  ]);
});

Deno.test("a manager offered the cleaning as free work hears of the hand-back, not the offer", () => {
  const folded = fold(
    group([
      row("cleaning_declined", { date: "2026-11-18", by_name: "Вера" }),
      row("cleaning_free", { date: "2026-11-18" }),
    ]),
  );

  assertEquals(folded?.type === "task" ? folded.event : null, "cleaning_declined");
});

Deno.test("a card given to her folds into one push with the titles the run read, or none without its id", () => {
  const cardId = "8c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
  const rows = [row("board_card_assigned", { card_id: cardId }), row("board_card_assigned", { card_id: cardId })];
  const base = group(rows);
  const as = (assigneeId: string | null, isLive: boolean) => ({
    ...base,
    cards: new Map([[cardId, { card: "Tiles", board: "Repairs", assigneeId, isLive }]]),
  });
  assertEquals(fold(as(base.recipientId, true)), { type: "card", cardId, card: "Tiles", board: "Repairs" });
  assertEquals(fold(as("someone-else", true)), null);
  assertEquals(fold(as(null, true)), null);
  assertEquals(fold(as(base.recipientId, false)), null);
  assertEquals(fold({ ...base, cards: new Map() }), null);
  assertEquals(fold(group([row("board_card_assigned", { card_id: cardId })])), {
    type: "card",
    cardId,
    card: null,
    board: null,
  });
  assertEquals(fold(group([row("board_card_assigned", {})])), null);
});
