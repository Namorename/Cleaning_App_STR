/**
 * Write a batch of reservations to the database.
 *
 * Shared by the nightly reconciliation and the webhook journal processor:
 * both receive raw reservations from Hostaway and put them into both layers
 * through one RPC.
 */

import {
  normalizeReservation,
  reservationUnits,
  type ReservationRow,
  type ReservationUnitLink,
} from "./reservation.ts";

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
  /** Links between a booking and the rooms it took; empty on ordinary listings. */
  readonly unitsFound: number;
  readonly unitsLinked: number;
  readonly unitsFreed: number;
  /** Rooms Hostaway names that we have no row for — run the listing sync. */
  readonly unknownUnitIds: number[];
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
  const units: ReservationUnitLink[] = [];
  const raws: Array<{ id: number; data: unknown; synced_at: string }> = [];
  const skipped: SkippedReservation[] = [];

  // One malformed reservation must not sink the batch: those that fail
  // normalization are set aside and reported, the rest reach the database.
  reservations.forEach((raw, position) => {
    try {
      const row = normalizeReservation(raw, syncedAt);
      rows.push(row);
      units.push(...reservationUnits(raw));
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
      unitsFound: 0,
      unitsLinked: 0,
      unitsFreed: 0,
      unknownUnitIds: [],
      unknownPropertyIds: [],
      departureRange: null,
    };
  }

  let rawUpserted = 0;
  let inserted = 0;
  let updated = 0;
  let unitsLinked = 0;
  let unitsFreed = 0;
  const unknownPropertyIds = new Set<number>();
  const unknownUnitIds = new Set<number>();

  for (let start = 0; start < rows.length; start += batchSize) {
    // The rooms of exactly the bookings in this batch. The RPC replaces the
    // set for every booking it writes, so a batch must carry all the rooms of
    // the bookings it carries — otherwise the ones left out look withdrawn.
    const batch = new Set(rows.slice(start, start + batchSize).map((row) => row.id));

    const counts = (await rpc("sync_hostaway_reservations", {
      raw_rows: raws.slice(start, start + batchSize),
      reservation_rows: rows.slice(start, start + batchSize),
      unit_rows: units.filter((link) => batch.has(link.reservation_id)),
    })) as Record<string, unknown> | null;

    const read = (key: string): number => Number((counts ?? {})[key] ?? 0);
    rawUpserted += read("raw_upserted");
    inserted += read("reservations_inserted");
    updated += read("reservations_updated");
    unitsLinked += read("units_linked");
    unitsFreed += read("units_freed");

    const unknownUnits = (counts ?? {}).skipped_unit_ids;
    if (Array.isArray(unknownUnits)) {
      for (const id of unknownUnits) {
        unknownUnitIds.add(Number(id));
      }
    }

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
    unitsFound: units.length,
    unitsLinked,
    unitsFreed,
    unknownUnitIds: [...unknownUnitIds],
    unknownPropertyIds: [...unknownPropertyIds],
    departureRange: { from: departures[0], to: departures[departures.length - 1] },
  };
}
