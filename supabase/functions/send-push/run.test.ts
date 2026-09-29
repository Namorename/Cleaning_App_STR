import { assertEquals, assertRejects } from "jsr:@std/assert@1";

import {
  type ExpoMessage,
  ExpoMixedProjectsError,
  type ExpoReceipt,
  ExpoRequestError,
  type ExpoTicket,
  ExpoUnavailableError,
} from "./expo.ts";
import { type PushDatabase, type PushSender, runSendPush } from "./run.ts";

/**
 * One run of the sender, every minute: take what is due, fold it, write it in
 * her language, send it, settle it; then read the receipts of what went out a
 * quarter of an hour ago. The database and Expo are replaced here; what is
 * asserted is what goes to each and what is settled.
 */

const TASK = "3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b";

function assignedGroup(recipient: string, tokens: string[], rowIds: number[]) {
  return {
    recipient_id: recipient,
    collapse_key: `task:${TASK}`,
    language: "en",
    tokens: tokens.map((token) => ({ token, platform: "android" })),
    places: { "900003": { name: "Flat C", hostaway_unit_id: null, parent: null } },
    rows: rowIds.map((id) => ({
      id,
      kind: "cleaning_assigned",
      task_id: TASK,
      thread_id: null,
      property_id: 900003,
      params: { date: "2026-10-02", type: "cleaning" },
      urgent: true,
    })),
  };
}

interface Rpc {
  name: string;
  args: Record<string, unknown>;
}

function database(batches: unknown[], receiptsDue: string[] = []) {
  const calls: Rpc[] = [];
  const db: PushDatabase = {
    rpc(name, args) {
      calls.push({ name, args });
      if (name === "claim_push_batch") {
        return Promise.resolve({ data: batches.shift() ?? [], error: null });
      }
      if (name === "claim_push_receipts") {
        return Promise.resolve({ data: receiptsDue, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { db, calls };
}

function sender(answer: (messages: readonly ExpoMessage[]) => ExpoTicket[] | Error) {
  const sent: ExpoMessage[][] = [];
  const asked: string[][] = [];
  const expo: PushSender = {
    send(messages) {
      sent.push([...messages]);
      const result = answer(messages);
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
    },
    receipts(ids) {
      asked.push([...ids]);
      return Promise.resolve(
        new Map<string, ExpoReceipt>([
          ["tk-old", { status: "error", details: { error: "DeviceNotRegistered" } }],
        ]),
      );
    },
  };
  return { expo, sent, asked };
}

const okTickets = (messages: readonly ExpoMessage[]): ExpoTicket[] =>
  messages.map((_, index) => ({ status: "ok", id: `tk-${index}` }));

const quiet = { log: () => {}, error: () => {} };

function settled(calls: Rpc[]) {
  return calls
    .filter((call) => call.name === "record_push_results")
    .flatMap((call) => call.args.p_results as Array<Record<string, unknown>>);
}

Deno.test("a due assignment goes to every phone she has, in her language, and is settled as sent", async () => {
  // Arrange
  const { db, calls } = database([[assignedGroup("anna", ["T1", "T2"], [11, 12])]]);
  const { expo, sent } = sender(okTickets);

  // Act
  const summary = await runSendPush(db, expo, quiet);

  // Assert: one push, to both phones.
  assertEquals(sent.length, 1);
  assertEquals(sent[0].map((m) => m.to), ["T1", "T2"]);
  const first = sent[0][0];
  assertEquals(first.title, "Cleaning assigned to you");
  assertEquals(first.body.startsWith("Flat C, "), true);
  assertEquals(first.data, { kind: "cleaning_assigned", taskId: TASK });
  assertEquals([first.channelId, first.interruptionLevel, first.priority, first.sound], [
    "urgent",
    "time-sensitive",
    "high",
    "default",
  ]);
  // Her phones are Android: tag replaces, and FCM gets no collapse key.
  assertEquals([first.collapseId, first.tag, first.threadId], [
    undefined,
    `task:${TASK}`,
    `task:${TASK}`,
  ]);

  // Both rows settled as sent, with one ticket per phone.
  assertEquals(settled(calls), [{
    outbox_ids: [11, 12],
    outcome: "sent",
    tickets: [
      { token: "T1", status: "ok", ticket_id: "tk-0", error: null, message: null },
      { token: "T2", status: "ok", ticket_id: "tk-1", error: null, message: null },
    ],
  }]);
  assertEquals(summary.sent, 1);
});

Deno.test("a message push names its thread, so the phone can tell the one on screen", async () => {
  // A repair's chat is opened on the phone through its cleaning, while the
  // server calls the thread a report's: only the thread's own id matches both.
  const thread = "5b6d4e8f-9a0b-4c2d-8e4f-5a6b3f2a1c4e";
  const problem = "9a0b1c2d-3e4f-4a5b-8f2a-1c4e5b6d4e8f";
  const { db } = database([[{
    recipient_id: "tomas",
    collapse_key: `thread:${thread}`,
    language: "en",
    tokens: [{ token: "T1", platform: "ios" }],
    places: { "900003": { name: "Flat C", hostaway_unit_id: null, parent: null } },
    rows: [{
      id: 91,
      kind: "chat_message",
      task_id: null,
      thread_id: thread,
      property_id: 900003,
      params: { subject: "problem", task_id: null, problem_id: problem, author_name: "Bara" },
      urgent: false,
    }],
  }]]);
  const { expo, sent } = sender(okTickets);

  await runSendPush(db, expo, quiet);

  assertEquals(sent[0][0].data, {
    kind: "chat_message",
    subject: "problem",
    id: problem,
    threadId: thread,
  });
});

Deno.test("a group that folds to nothing is settled as collapsed and not sent", async () => {
  const group = assignedGroup("anna", ["T1"], [21]);
  const taken = {
    ...group,
    rows: [...group.rows, { ...group.rows[0], id: 22, kind: "cleaning_unassigned" }],
  };
  const { db, calls } = database([[taken]]);
  const { expo, sent } = sender(okTickets);

  await runSendPush(db, expo, quiet);

  assertEquals(sent.length, 0);
  assertEquals(settled(calls), [{ outbox_ids: [21, 22], outcome: "collapsed", tickets: [] }]);
});

Deno.test("rows this build cannot read are settled as skipped, the rest still goes", async () => {
  const group = assignedGroup("anna", ["T1"], [31]);
  const withNews = {
    ...group,
    rows: [...group.rows, { ...group.rows[0], id: 32, kind: "invoice_paid" }],
  };
  const { db, calls } = database([[withNews]]);
  const { expo, sent } = sender(okTickets);

  await runSendPush(db, expo, quiet);

  assertEquals(sent.length, 1);
  assertEquals(settled(calls).map((result) => [result.outbox_ids, result.outcome]), [
    [[32], "skipped"],
    [[31], "sent"],
  ]);
});

Deno.test("when Expo cannot be reached the groups are let go for the next run", async () => {
  const { db, calls } = database([[assignedGroup("anna", ["T1"], [41])]]);
  const { expo } = sender(() => new ExpoUnavailableError("down"));
  const errors: unknown[] = [];

  const summary = await runSendPush(db, expo, {
    log: () => {},
    error: (...args) => errors.push(args),
  });

  assertEquals(settled(calls), [{ outbox_ids: [41], outcome: "failed", tickets: [] }]);
  assertEquals(summary.failed, 1);
  assertEquals(errors.length, 1);
});

Deno.test("a phone of another Expo project does not silence everyone sent with it", async () => {
  // A tester's development build registered in the company: Expo refuses a
  // request that mixes projects and names each project's phones. Each
  // project's messages go again in a request of their own.
  const { db, calls } = database([[
    assignedGroup("anna", ["A1"], [71]),
    assignedGroup("tester", ["D1"], [72]),
    assignedGroup("bara", ["B1"], [73]),
  ]]);
  const { expo, sent } = sender((messages) =>
    messages.length === 3
      ? new ExpoMixedProjectsError("PUSH_TOO_MANY_EXPERIENCE_IDS", [["A1", "B1"], ["D1"]])
      : okTickets(messages)
  );

  await runSendPush(db, expo, quiet);

  assertEquals(sent.map((request) => request.map((m) => m.to)), [
    ["A1", "D1", "B1"],
    ["A1", "B1"],
    ["D1"],
  ]);
  assertEquals(settled(calls).map((s) => [s.outbox_ids, s.outcome]), [
    [[71], "sent"],
    [[72], "sent"],
    [[73], "sent"],
  ]);
});

Deno.test("when one project's request fails, only the groups wholly in it go again", async () => {
  const { db, calls } = database([[
    assignedGroup("anna", ["A1"], [81]),
    assignedGroup("tester", ["D1"], [82]),
  ]]);
  const { expo } = sender((messages) => {
    if (messages.length === 2) {
      return new ExpoMixedProjectsError("PUSH_TOO_MANY_EXPERIENCE_IDS", [["A1"], ["D1"]]);
    }
    return messages[0].to === "D1"
      ? new ExpoRequestError("Expo refused the request (401)")
      : okTickets(messages);
  });
  const errors: unknown[] = [];

  await runSendPush(db, expo, { log: () => {}, error: (...args) => errors.push(args) });

  assertEquals(settled(calls).map((s) => [s.outbox_ids, s.outcome]), [
    [[81], "sent"],
    [[82], "failed"],
  ]);
  assertEquals(errors.length, 1);
});

Deno.test("a group split across projects is settled with what reached her, never sent twice", async () => {
  // Her phone and her own development build: the build's request fails after
  // the phone got the push. Going again would repeat it on the phone.
  const { db, calls } = database([[assignedGroup("anna", ["A1", "D1"], [91])]]);
  const { expo } = sender((messages) => {
    if (messages.length === 2) {
      return new ExpoMixedProjectsError("PUSH_TOO_MANY_EXPERIENCE_IDS", [["A1"], ["D1"]]);
    }
    return messages[0].to === "D1" ? new ExpoUnavailableError("down") : okTickets(messages);
  });

  await runSendPush(db, expo, quiet);

  const [result] = settled(calls);
  assertEquals(result.outcome, "sent");
  assertEquals(
    (result.tickets as Array<Record<string, unknown>>).map((t) => [t.token, t.status, t.error]),
    [["A1", "ok", null], ["D1", "error", "RequestFailed"]],
  );
});

Deno.test("broken push keys are said loudly in the log", async () => {
  const { db } = database([[assignedGroup("anna", ["T1"], [51])]]);
  const { expo } = sender(() => [{
    status: "error",
    message: "The Apple Push Notification service key is invalid",
    details: { error: "InvalidCredentials" },
  }]);
  const errors: string[] = [];

  await runSendPush(db, expo, { log: () => {}, error: (text) => errors.push(String(text)) });

  assertEquals(errors.some((text) => text.includes("InvalidCredentials")), true);
});

Deno.test("a group is never split across two requests to Expo", async () => {
  // Three people with three phones each, and room for five messages a request.
  const batch = [
    assignedGroup("a", ["A1", "A2", "A3"], [61]),
    assignedGroup("b", ["B1", "B2", "B3"], [62]),
    assignedGroup("c", ["C1", "C2", "C3"], [63]),
  ];
  const { db } = database([batch]);
  const { expo, sent } = sender(okTickets);

  await runSendPush(db, expo, { ...quiet, messagesPerRequest: 5 });

  assertEquals(sent.map((request) => request.map((m) => m.to)), [
    ["A1", "A2", "A3"],
    ["B1", "B2", "B3"],
    ["C1", "C2", "C3"],
  ]);
});

Deno.test("a full batch means more may be due: the run asks again, up to its bound", async () => {
  const { db, calls } = database([
    [assignedGroup("a", ["A"], [71])],
    [assignedGroup("b", ["B"], [72])],
    [assignedGroup("c", ["C"], [73])],
  ]);
  const { expo } = sender(okTickets);

  await runSendPush(db, expo, { ...quiet, groupsPerBatch: 1, maxBatches: 2 });

  assertEquals(calls.filter((call) => call.name === "claim_push_batch").length, 2);
});

Deno.test("receipts of what went out a while ago are asked for and settled", async () => {
  const { db, calls } = database([[]], ["tk-old", "tk-pending"]);
  const { expo, asked } = sender(okTickets);

  await runSendPush(db, expo, quiet);

  assertEquals(asked, [["tk-old", "tk-pending"]]);
  const recorded = calls.find((call) => call.name === "record_push_receipts");
  // A ticket Expo has no receipt for yet is left for the next run.
  assertEquals(recorded?.args, {
    p_receipts: [
      { ticket_id: "tk-old", status: "error", error: "DeviceNotRegistered", message: null },
    ],
  });
});

Deno.test("a database that refuses to settle stops the run loudly", async () => {
  const db: PushDatabase = {
    rpc(name) {
      if (name === "claim_push_batch") {
        return Promise.resolve({ data: [assignedGroup("a", ["A"], [81])], error: null });
      }
      return Promise.resolve({ data: null, error: { message: "permission denied" } });
    },
  };
  const { expo } = sender(okTickets);

  await assertRejects(() => runSendPush(db, expo, quiet), Error, "record_push_results");
});

Deno.test("a group that folds into a kind she switched off is settled as muted, never sent", async () => {
  const group = {
    ...assignedGroup("anna", ["T1"], [91]),
    lease: "lease-1",
    muted: ["cleaning_assigned"],
  };
  const { db, calls } = database([[group]]);
  const { expo, sent } = sender(okTickets);

  const summary = await runSendPush(db, expo, quiet);

  assertEquals(sent.length, 0);
  assertEquals(settled(calls), [{
    outbox_ids: [91],
    lease: "lease-1",
    outcome: "muted",
    tickets: [],
  }]);
  assertEquals(summary.muted, 1);
});

Deno.test("half of a burst switched off does not send the other half", async () => {
  // Given, then taken away, with "taken away" switched off: the fold still
  // sees both halves, and says nothing.
  const base = assignedGroup("anna", ["T1"], [92]);
  const group = {
    ...base,
    muted: ["cleaning_unassigned"],
    rows: [...base.rows, { ...base.rows[0], id: 93, kind: "cleaning_unassigned" }],
  };
  const { db, calls } = database([[group]]);
  const { expo, sent } = sender(okTickets);

  await runSendPush(db, expo, quiet);

  assertEquals(sent.length, 0);
  assertEquals(settled(calls)[0].outcome, "collapsed");
});

Deno.test("each group is settled under the lease it was handed out with", async () => {
  const { db, calls } = database([[{ ...assignedGroup("anna", ["T1"], [94]), lease: "lease-2" }]]);
  const { expo } = sender(okTickets);

  await runSendPush(db, expo, quiet);

  assertEquals(settled(calls)[0].lease, "lease-2");
});

Deno.test("Android is not given a collapse key: FCM keeps only four for a phone that is off", async () => {
  // tag replaces the notification on an Android screen; collapseId is the
  // iPhone's own. With a collapse key FCM would drop all but four pushes for
  // a phone out of signal.
  const group = {
    ...assignedGroup("anna", [], [95]),
    tokens: [{ token: "A", platform: "android" }, { token: "I", platform: "ios" }],
  };
  const { db } = database([[group]]);
  const { expo, sent } = sender(okTickets);

  await runSendPush(db, expo, quiet);

  const [android, iphone] = sent[0];
  assertEquals(android.collapseId, undefined);
  assertEquals(android.tag, `task:${TASK}`);
  assertEquals(iphone.collapseId, `task:${TASK}`);
});

Deno.test("one group that cannot be written is set aside; the rest of the batch goes", async () => {
  const good = assignedGroup("anna", ["A"], [97]);
  const broken = {
    ...assignedGroup("bara", ["B"], [96]),
    rows: [{ ...assignedGroup("bara", ["B"], [96]).rows[0], params: { date: "not a day" } }],
  };
  const { db, calls } = database([[broken, good]]);
  const { expo, sent } = sender(okTickets);
  const errors: unknown[] = [];

  await runSendPush(db, expo, { log: () => {}, error: (...args) => errors.push(args) });

  assertEquals(sent.flat().map((m) => m.to), ["A"]);
  const outcomes = Object.fromEntries(
    settled(calls).map((s) => [(s.outbox_ids as number[])[0], s.outcome]),
  );
  assertEquals(outcomes, { 96: "skipped", 97: "sent" });
  assertEquals(errors.length, 1);
});

Deno.test("a run out of time starts no further request: its groups go again", async () => {
  // The lease is two minutes. A group still unsent when the batch's time is
  // up is let go under its own lease, not sent after another run took it.
  let clock = 0;
  const { db, calls } = database([[assignedGroup("anna", ["A"], [98]), assignedGroup("bara", ["B"], [99])]]);
  const { expo, sent } = sender((messages) => {
    clock += 120_000;
    return okTickets(messages);
  });

  await runSendPush(db, expo, { ...quiet, messagesPerRequest: 1, now: () => clock });

  assertEquals(sent.map((request) => request.map((m) => m.to)), [["A"]]);
  const outcomes = Object.fromEntries(
    settled(calls).map((s) => [(s.outbox_ids as number[])[0], s.outcome]),
  );
  assertEquals(outcomes, { 98: "sent", 99: "failed" });
});

Deno.test("broken push keys reported in receipts are said loudly in the log too", async () => {
  const { db } = database([[]], ["tk-keys"]);
  const expo: PushSender = {
    send: () => Promise.resolve([]),
    receipts: () =>
      Promise.resolve(
        new Map<string, ExpoReceipt>([
          ["tk-keys", { status: "error", details: { error: "InvalidCredentials" } }],
        ]),
      ),
  };
  const errors: string[] = [];

  await runSendPush(db, expo, { log: () => {}, error: (text) => errors.push(String(text)) });

  assertEquals(errors.some((text) => text.includes("InvalidCredentials")), true);
});
