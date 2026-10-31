import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

import { Constants, type Database } from "../../../../packages/shared/src/database.types.ts";
import { type SignalKind, STORED_PROVIDERS, type StoredProvider } from "./adapter.ts";
import { createClassifyStore, queueFilter } from "./classify-db.ts";
import { buildingIds, createSyncStore } from "./db.ts";
import { SIGNAL_CHANNELS, type SignalChannel } from "./types.ts";

// The stores against a recording fake of supabase-js: the RPC names and
// arguments they send. Every expected argument object is typed by the
// generated database types, so a name the migration does not have fails the
// type check, and the run checks the store sends exactly that object.

type Functions = Database["public"]["Functions"];
type Args<F extends keyof Functions> = Functions[F]["Args"];
type Enums = Database["public"]["Enums"];

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const PROVIDERS_MATCH: Same<StoredProvider, Enums["signal_provider"]> = true;
const KINDS_MATCH: Same<SignalKind, Enums["guest_signal_kind"]> = true;
const CHANNELS_MATCH: Same<SignalChannel, Enums["signal_channel"]> = true;

const HOST = "00000000-0000-4000-8000-0000000000aa";

interface Recorded {
  readonly name: string;
  readonly args: unknown;
}

interface Query {
  readonly table: string;
  readonly chain: Array<[string, unknown[]]>;
}

const QUERY_METHODS = ["select", "eq", "not", "or", "order", "limit", "maybeSingle"] as const;

/** supabase-js on a fake: rpc and from() record what they are asked and answer from `answers`. */
function fakeClient(answers: Readonly<Record<string, unknown>> = {}) {
  const rpcs: Recorded[] = [];
  const queries: Query[] = [];
  const client = {
    rpc(name: string, args?: unknown) {
      rpcs.push({ name, args });
      return Promise.resolve({ data: answers[name] ?? null, error: null });
    },
    from(table: string) {
      const query: Query = { table, chain: [] };
      queries.push(query);
      // A real promise carrying the builder's methods: awaiting any step answers.
      const result = Promise.resolve({ data: answers[`from:${table}`] ?? null, error: null });
      const builder: Record<string, unknown> = result as unknown as Record<string, unknown>;
      for (const method of QUERY_METHODS) {
        builder[method] = (...args: unknown[]) => {
          query.chain.push([method, args]);
          return builder;
        };
      }
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, rpcs, queries };
}

Deno.test("the core's provider, kind and channel lists are the database's enums", () => {
  assertEquals([PROVIDERS_MATCH, KINDS_MATCH, CHANNELS_MATCH], [true, true, true]);
  assertEquals([...STORED_PROVIDERS], [...Constants.public.Enums.signal_provider]);
  assertEquals([...SIGNAL_CHANNELS], [...Constants.public.Enums.signal_channel]);
});

Deno.test("the load reads the review settings and the watermark of its provider and kind", async () => {
  const { client, rpcs, queries } = fakeClient({ signal_sync_watermark: "2026-10-14T06:00:00+00:00" });
  const store = createSyncStore(client, HOST, "hostaway");

  await store.settings();
  assertEquals(queries[0].table, "signal_settings");
  assertEquals(queries[0].chain.filter(([m]) => m === "eq"), [["eq", ["host_id", HOST]], ["eq", ["kind", "review"]]]);

  assertEquals(await store.watermark(), new Date("2026-10-14T06:00:00Z"));
  const watermark: Args<"signal_sync_watermark"> = { p_provider: "hostaway", p_kind: "review", p_host_id: HOST };
  assertEquals(rpcs, [{ name: "signal_sync_watermark", args: watermark }]);
});

Deno.test("buildings are the PMS's listing ids from signal_buildings", async () => {
  const { client, rpcs } = fakeClient({ signal_buildings: ["700001", "700002"] });
  const store = createSyncStore(client, HOST, "hostaway");

  assertEquals(await store.buildings(), new Set(["700001", "700002"]));
  const args: Args<"signal_buildings"> = { p_provider: "hostaway", p_host_id: HOST };
  assertEquals(rpcs, [{ name: "signal_buildings", args }]);
  assertEquals(buildingIds(null), new Set());
  assertThrows(() => buildingIds([700001]), Error, "list of ids");
  assertThrows(() => buildingIds({ ids: [] }), Error, "list of ids");
});

Deno.test("what the database holds is asked by keys, in portions, and a row of another shape stops the run", async () => {
  const row = {
    external_key: "a".repeat(64),
    public_kept: true,
    private_kept: false,
    comments_kept: false,
    text_allowed: true,
    stay_exact: true,
    room_known: false,
  };
  const { client, rpcs } = fakeClient({ review_load_state: [row] });
  const store = createSyncStore(client, HOST, "hostaway");
  const keys = Array.from({ length: 501 }, (_, i) => i.toString(16).padStart(64, "0"));

  const state = await store.loadState(keys);
  assertEquals(state.get(row.external_key), {
    publicKept: true,
    privateKept: false,
    commentsKept: false,
    textAllowed: true,
    stayExact: true,
    roomKnown: false,
  });
  const first: Args<"review_load_state"> = { p_provider: "hostaway", p_keys: keys.slice(0, 500), p_host_id: HOST };
  assertEquals(rpcs.length, 2);
  assertEquals(rpcs[0], { name: "review_load_state", args: first });

  const broken = createSyncStore(fakeClient({ review_load_state: [{ external_key: "x" }] }).client, HOST, "hostaway");
  await assertRejects(() => broken.loadState(["x"]), Error, "unexpected shape");
});

Deno.test("a portion goes to ingest_guest_reviews under the adapter's provider", async () => {
  const { client, rpcs } = fakeClient({
    ingest_guest_reviews: { inserted: 1, updated: 0, cut: 1, journal_written: true },
  });
  const store = createSyncStore(client, HOST, "hostaway");
  const result = await store.ingest([], new Date("2026-10-15T06:00:00Z"), [{ code: "source_bad_row", count: 1 }], {
    fetched: 0,
    with_texts: 0,
    booking_lookups: 0,
    held_for_names: 0,
    texts_without_names: 0,
  });

  assertEquals(result, { inserted: 1, updated: 0, cut: 1, journal_written: true });
  const args: Args<"ingest_guest_reviews"> = {
    p_provider: "hostaway",
    p_rows: [],
    p_watermark: "2026-10-15T06:00:00.000Z",
    p_host_id: HOST,
    p_errors: [{ code: "source_bad_row", count: 1 }],
    p_counts: { fetched: 0, with_texts: 0, booking_lookups: 0, held_for_names: 0, texts_without_names: 0 },
  };
  assertEquals(rpcs, [{ name: "ingest_guest_reviews", args }]);
});

Deno.test("the reading run's queue is the reviews of its provider; its calls are booked and journaled under the reviews' kind", async () => {
  const { client, rpcs, queries } = fakeClient({ reserve_signal_model_calls: 3 });
  const store = createClassifyStore(client, HOST, "hostaway");

  await store.queue(200, null);
  assertEquals(queries[0].table, "guest_signals");
  assertEquals(queries[0].chain.filter(([m]) => m === "eq"), [
    ["eq", ["host_id", HOST]],
    ["eq", ["provider", "hostaway"]],
    ["eq", ["kind", "review"]],
  ]);
  assertEquals(queries[0].chain.find(([m]) => m === "or"), ["or", [queueFilter(null)]]);

  assertEquals(await store.reserveCalls(5), 3);
  await store.apply("00000000-0000-4000-8000-000000000001", "rules-v1", null, []);
  await store.markFailed("00000000-0000-4000-8000-000000000001", "model_timeout");
  await store.log(true, { read: 1 }, []);

  const reserve: Args<"reserve_signal_model_calls"> = {
    p_provider: "hostaway",
    p_kind: "review",
    p_wanted: 5,
    p_host_id: HOST,
  };
  // The generated types cannot say an argument takes null; the rules' reading has no language.
  const apply: Omit<Args<"apply_signal_findings">, "p_language"> & { p_language: string | null } = {
    p_signal_id: "00000000-0000-4000-8000-000000000001",
    p_detector: "rules-v1",
    p_language: null,
    p_findings: [],
  };
  const failed: Args<"mark_signal_analysis_failed"> = {
    p_signal_id: "00000000-0000-4000-8000-000000000001",
    p_error: "model_timeout",
  };
  const log: Args<"log_signal_run"> = {
    p_provider: "hostaway",
    p_kind: "review",
    p_stage: "classify",
    p_is_ok: true,
    p_counts: { read: 1 },
    p_errors: [],
    p_host_id: HOST,
  };
  assertEquals(rpcs, [
    { name: "reserve_signal_model_calls", args: reserve },
    { name: "apply_signal_findings", args: apply },
    { name: "mark_signal_analysis_failed", args: failed },
    { name: "log_signal_run", args: log },
  ]);
});

Deno.test("the reading run's settings are the reviews' row", async () => {
  const { client, queries } = fakeClient();
  await createClassifyStore(client, HOST, "hostaway").settings();
  assertEquals(queries[0].table, "signal_settings");
  assertEquals(queries[0].chain.filter(([m]) => m === "eq"), [["eq", ["host_id", HOST]], ["eq", ["kind", "review"]]]);
});
