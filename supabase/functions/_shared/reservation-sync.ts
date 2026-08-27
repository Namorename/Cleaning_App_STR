/**
 * Запись пачки броней в базу.
 *
 * Общее для суточной сверки и разбора журнала вебхуков: обе получают сырые
 * брони от Hostaway и кладут их в оба слоя одним вызовом RPC.
 */

import { normalizeReservation, type ReservationRow } from "./reservation.ts";

/** Узкий контракт вместо зависимости от типа клиента Supabase — так проще подменять в тестах. */
export type RpcCaller = (fn: string, args: Record<string, unknown>) => Promise<unknown>;

/**
 * Сколько броней уходит в базу за один вызов RPC.
 *
 * Выяснено на живых данных: суточная сверка приносит около 1358 броней по 137
 * полей каждая — это порядка 11 МБ JSONB, и один такой вызов упирается в
 * statement timeout. Пачками по 200 та же выгрузка проходит спокойно.
 */
export const DB_BATCH_SIZE = 200;

export interface SkippedReservation {
  readonly position: number;
  readonly reason: string;
}

export interface ReservationPushResult {
  readonly fetched: number;
  readonly normalized: number;
  readonly skipped: SkippedReservation[];
  readonly rawUpserted: number;
  readonly inserted: number;
  readonly updated: number;
  /** Объекты, которых нет в properties: значит, пора обновить листинги. */
  readonly unknownPropertyIds: number[];
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function pushReservations(
  reservations: readonly unknown[],
  syncedAt: string,
  rpc: RpcCaller,
  batchSize: number = DB_BATCH_SIZE,
): Promise<ReservationPushResult> {
  const rows: ReservationRow[] = [];
  const raws: Array<{ id: number; data: unknown; synced_at: string }> = [];
  const skipped: SkippedReservation[] = [];

  // Одна кривая бронь не должна ронять всю пачку: непрошедшие нормализацию
  // откладываются и возвращаются наружу, остальные доезжают до базы.
  reservations.forEach((raw, position) => {
    try {
      const row = normalizeReservation(raw, syncedAt);
      rows.push(row);
      raws.push({ id: row.id, data: raw, synced_at: syncedAt });
    } catch (error: unknown) {
      const reason = getErrorMessage(error);
      skipped.push({ position, reason });
      console.error(`Бронь на позиции ${position} пропущена: ${reason}`);
    }
  });

  if (rows.length === 0) {
    return {
      fetched: reservations.length,
      normalized: 0,
      skipped,
      rawUpserted: 0,
      inserted: 0,
      updated: 0,
      unknownPropertyIds: [],
    };
  }

  let rawUpserted = 0;
  let inserted = 0;
  let updated = 0;
  const unknownPropertyIds = new Set<number>();

  for (let start = 0; start < rows.length; start += batchSize) {
    const counts = (await rpc("sync_hostaway_reservations", {
      raw_rows: raws.slice(start, start + batchSize),
      reservation_rows: rows.slice(start, start + batchSize),
    })) as Record<string, unknown> | null;

    const read = (key: string): number => Number((counts ?? {})[key] ?? 0);
    rawUpserted += read("raw_upserted");
    inserted += read("reservations_inserted");
    updated += read("reservations_updated");

    const unknownIds = (counts ?? {}).skipped_property_ids;
    if (Array.isArray(unknownIds)) {
      for (const id of unknownIds) {
        unknownPropertyIds.add(Number(id));
      }
    }
  }

  return {
    fetched: reservations.length,
    normalized: rows.length,
    skipped,
    rawUpserted,
    inserted,
    updated,
    unknownPropertyIds: [...unknownPropertyIds],
  };
}
