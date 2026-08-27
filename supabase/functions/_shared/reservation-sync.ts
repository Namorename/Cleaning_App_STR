/**
 * Write a batch of reservations to the database.
 *
 * Shared by the nightly reconciliation and the webhook journal processor:
 * both receive raw reservations from Hostaway and put them into both layers
 * through one RPC.
 */

import { normalizeReservation, type ReservationRow } from "./reservation.ts";

/** A narrow contract instead of depending on the Supabase client type — easier to stub in tests. */
export type RpcCaller = (fn: string, args: Record<string, unknown>) => Promise<unknown>;

/**
 * How many reservations go to the database per RPC call.
 *
 * Established against live data: the nightly reconciliation brings about 1358
 * reservations of 137 fields each — roughly 11 MB of JSONB — and a single call
 * of that size hits the statement timeout. In batches of 200 the same load
 * goes through comfortably.
 */
export const DB_BATCH_SIZE = 200;

export interface SkippedReservation {
  readonly position: number;
  readonly reason: string;
}

export interface DepartureRange {
  readonly from: string;
  readonly to: string;
}

export interface ReservationPushResult {
  readonly fetched: number;
  readonly normalized: number;
  readonly skipped: SkippedReservation[];
  readonly rawUpserted: number;
  readonly inserted: number;
  readonly updated: number;
  /** Properties absent from the properties table: time to refresh the listings. */
  readonly unknownPropertyIds: number[];
  /**
   * Departure dates covered by this batch, or null when nothing was written.
   *
   * The caller reconciles cleaning tasks over exactly this window. A fixed
   * window would miss a booking that departs far in the future — those arrive
   * by webhook and can sit well beyond the reconciliation horizon.
   */
  readonly departureRange: DepartureRange | null;
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

  // One malformed reservation must not sink the batch: those that fail
  // normalization are set aside and reported, the rest reach the database.
  reservations.forEach((raw, position) => {
    try {
      const row = normalizeReservation(raw, syncedAt);
      rows.push(row);
      raws.push({ id: row.id, data: raw, synced_at: syncedAt });
    } catch (error: unknown) {
      const reason = getErrorMessage(error);
      skipped.push({ position, reason });
      console.error(`Reservation at position ${position} skipped: ${reason}`);
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
      departureRange: null,
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

  // ISO dates sort lexicographically, so plain string comparison is enough.
  const departures = rows.map((row) => row.departure_date).sort();

  return {
    fetched: reservations.length,
    normalized: rows.length,
    skipped,
    rawUpserted,
    inserted,
    updated,
    unknownPropertyIds: [...unknownPropertyIds],
    departureRange: { from: departures[0], to: departures[departures.length - 1] },
  };
}
