/**
 * Разбор журнала вебхуков.
 *
 * Приёмник (hostaway-webhook) только складывает уведомления и отвечает 200 за
 * доли секунды — Hostaway ждёт подтверждения не дольше 20 секунд. Вся работа
 * происходит здесь.
 *
 * ТЕЛУ УВЕДОМЛЕНИЯ НЕ ДОВЕРЯЕМ. Подписи у Hostaway нет, защита вебхука —
 * только пара логин-пароль, поэтому подделать уведомление проще, чем подделать
 * ответ API на наш собственный запрос. Из уведомления берётся лишь одно:
 * «объект такой-то изменился». Актуальное состояние брони запрашивается
 * отдельно, своими ключами.
 *
 * Побочная выгода — идемпотентность. Hostaway прямо предупреждает, что об
 * одном изменении может прийти несколько уведомлений. Повторы схлопываются
 * сами: одинаковые objectId дают один запрос и один upsert.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { readConfig } from "../_shared/env.ts";
import { HostawayClient } from "../_shared/hostaway.ts";
import { pushReservations, type RpcCaller } from "../_shared/reservation-sync.ts";

const BATCH_SIZE = 50;
const RESERVATION_OBJECT = "reservation";

interface ClaimedEvent {
  readonly id: number;
  readonly object_type: string | null;
  readonly object_id: number | null;
  readonly event_type: string | null;
  readonly attempts: number;
}

interface ProcessSummary {
  claimed: number;
  reservationsFetched: number;
  inserted: number;
  updated: number;
  processed: number;
  skipped: number;
  failed: number;
  unknownPropertyIds: number[];
  durationMs: number;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function markEvents(
  rpc: RpcCaller,
  ids: readonly number[],
  status: "processed" | "skipped" | "failed",
  error?: string,
): Promise<void> {
  if (ids.length === 0) {
    return;
  }

  await rpc("mark_webhook_events", {
    event_ids: ids,
    new_status: status,
    error_text: error ?? null,
  });
}

async function processBatch(): Promise<ProcessSummary> {
  const startedAt = Date.now();
  const config = readConfig(Deno.env);
  const supabase = createClient(config.supabaseUrl, config.supabaseSecretKey, {
    auth: { persistSession: false },
  });

  const rpc: RpcCaller = async (fn, args) => {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) {
      throw new Error(`RPC ${fn}: ${error.message}`);
    }
    return data;
  };

  const claimed = ((await rpc("claim_webhook_events", {
    batch_size: BATCH_SIZE,
  })) ?? []) as ClaimedEvent[];

  const summary: ProcessSummary = {
    claimed: claimed.length,
    reservationsFetched: 0,
    inserted: 0,
    updated: 0,
    processed: 0,
    skipped: 0,
    failed: 0,
    unknownPropertyIds: [],
    durationMs: 0,
  };

  if (claimed.length === 0) {
    summary.durationMs = Date.now() - startedAt;
    return summary;
  }

  // Уведомления не про брони откладываем как неинтересные, но из журнала
  // не удаляем — пусть остаются историей.
  const reservationEvents = claimed.filter(
    (event) => event.object_type === RESERVATION_OBJECT && event.object_id !== null,
  );
  const otherEventIds = claimed
    .filter((event) => event.object_type !== RESERVATION_OBJECT || event.object_id === null)
    .map((event) => event.id);

  await markEvents(rpc, otherEventIds, "skipped");
  summary.skipped = otherEventIds.length;

  // Схлопывание дублей: несколько уведомлений об одной брони дают один запрос.
  const byReservation = new Map<number, number[]>();
  for (const event of reservationEvents) {
    const id = event.object_id as number;
    byReservation.set(id, [...(byReservation.get(id) ?? []), event.id]);
  }

  const hostaway = new HostawayClient(config.hostaway);
  const syncedAt = new Date(startedAt).toISOString();

  const fetched: unknown[] = [];
  const okEventIds: number[] = [];

  for (const [reservationId, eventIds] of byReservation) {
    try {
      fetched.push(await hostaway.getObject(`reservations/${reservationId}`));
      okEventIds.push(...eventIds);
    } catch (error: unknown) {
      // Одна недоступная бронь не должна ронять пачку: остальные доедут,
      // а эта останется в журнале с описанием ошибки.
      const message = getErrorMessage(error);
      console.error(`Reservation ${reservationId} could not be fetched: ${message}`);
      await markEvents(rpc, eventIds, "failed", message);
      summary.failed += eventIds.length;
    }
  }

  summary.reservationsFetched = fetched.length;

  if (fetched.length > 0) {
    const result = await pushReservations(fetched, syncedAt, rpc);
    summary.inserted = result.inserted;
    summary.updated = result.updated;
    summary.unknownPropertyIds = result.unknownPropertyIds;

    if (result.unknownPropertyIds.length > 0) {
      console.error(
        `Reservations reference unknown properties: ${result.unknownPropertyIds.join(", ")}. ` +
          "Run sync-listings.",
      );
    }

    await markEvents(rpc, okEventIds, "processed");
    summary.processed = okEventIds.length;
  }

  summary.durationMs = Date.now() - startedAt;
  return summary;
}

Deno.serve(async () => {
  try {
    const summary = await processBatch();
    console.info(
      `Journal processing: claimed ${summary.claimed}, reservations ${summary.reservationsFetched}, ` +
        `inserted ${summary.inserted}, updated ${summary.updated}, ` +
        `skipped ${summary.skipped}, failed ${summary.failed}`,
    );
    return Response.json({ success: true, data: summary });
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    console.error(`Webhook journal processing failed: ${message}`);
    return Response.json({ success: false, error: message }, { status: 500 });
  }
});
