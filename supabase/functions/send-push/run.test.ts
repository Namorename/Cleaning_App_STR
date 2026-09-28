import { assertEquals, assertRejects } from "jsr:@std/assert@1";

import {
  type ExpoMessage,
  type ExpoReceipt,
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
  assertEquals([first.collapseId, first.tag, first.threadId], [
    `task:${TASK}`,
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
