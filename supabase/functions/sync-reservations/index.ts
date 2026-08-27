/**
 * Суточная сверка броней.
 *
 * Страховка на случай потерянного вебхука. Hostaway не повторяет доставку
 * после 4xx, поэтому единственная ошибка в учётных данных означает тихо
 * пропавшую бронь — сверка её подберёт.
 *
 * Берётся не вся история, а окно по дате ВЫЕЗДА: уборки привязаны именно
 * к выездам. Замер на живом аккаунте:
 *   вся история        30 887 броней  155 страниц
 *   -7 .. +90 дней      1 358 броней    7 страниц
 * Второе укладывается в таймаут функции с большим запасом.
 *
 * Фильтра «изменённые с такого-то времени» у Hostaway нет — только диапазоны
 * по датам заезда и выезда, поэтому окно именно такое.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { readConfig } from "../_shared/env.ts";
import { HostawayClient } from "../_shared/hostaway.ts";
import { pushReservations, type ReservationPushResult } from "../_shared/reservation-sync.ts";

const RESERVATIONS_ENDPOINT = "reservations";
const PAGE_SIZE = 200;

/** Прошедшие выезды: уборка могла быть ещё не закрыта. */
const DEFAULT_DAYS_BACK = 7;
/** Будущие выезды: горизонт планирования уборок. */
const DEFAULT_DAYS_FORWARD = 90;

interface SyncWindow {
  readonly from: string;
  readonly to: string;
}

function shiftDate(base: Date, days: number): string {
  const shifted = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function readWindow(url: URL, now: Date): SyncWindow {
  const back = Number(url.searchParams.get("daysBack") ?? DEFAULT_DAYS_BACK);
  const forward = Number(url.searchParams.get("daysForward") ?? DEFAULT_DAYS_FORWARD);

  return {
    from: shiftDate(now, -Math.abs(Number.isFinite(back) ? back : DEFAULT_DAYS_BACK)),
    to: shiftDate(now, Math.abs(Number.isFinite(forward) ? forward : DEFAULT_DAYS_FORWARD)),
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runReconciliation(
  window: SyncWindow,
): Promise<ReservationPushResult & { window: SyncWindow; durationMs: number }> {
  const startedAt = Date.now();
  const config = readConfig(Deno.env);
  const syncedAt = new Date(startedAt).toISOString();

  const hostaway = new HostawayClient(config.hostaway);
  const reservations = await hostaway.listAll(RESERVATIONS_ENDPOINT, PAGE_SIZE, {
    departureStartDate: window.from,
    departureEndDate: window.to,
  });
  console.info(`Fetched reservations from Hostaway: ${reservations.length} (${window.from}..${window.to})`);

  const supabase = createClient(config.supabaseUrl, config.supabaseSecretKey, {
    auth: { persistSession: false },
  });

  const result = await pushReservations(reservations, syncedAt, async (fn, args) => {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) {
      throw new Error(`RPC ${fn}: ${error.message}`);
    }
    return data;
  });

  if (result.unknownPropertyIds.length > 0) {
    console.error(
      `Reservations reference unknown properties: ${result.unknownPropertyIds.join(", ")}. ` +
        "Run sync-listings — a new listing was probably added in Hostaway.",
    );
  }

  return { ...result, window, durationMs: Date.now() - startedAt };
}

Deno.serve(async (request: Request) => {
  try {
    const window = readWindow(new URL(request.url), new Date());
    const summary = await runReconciliation(window);

    console.info(
      `Reconciliation finished in ${summary.durationMs} ms: inserted ${summary.inserted}, ` +
        `updated ${summary.updated}, skipped ${summary.skipped.length}`,
    );

    return Response.json({ success: true, data: summary });
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    console.error(`Reservation reconciliation failed: ${message}`);
    return Response.json({ success: false, error: message }, { status: 502 });
  }
});
