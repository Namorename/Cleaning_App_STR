/**
 * Синхронизация объектов из Hostaway.
 *
 * Выгружает listings целиком, кладёт сырой JSON в raw.hostaway_listings и
 * нормализованные строки в public.properties — одной транзакцией через RPC.
 *
 * Про логирование: правила проекта запрещают console.log в продакшене, но в
 * Edge Functions консоль и есть штатный журнал — вывод уходит в логи Supabase.
 * Поэтому здесь используются console.info и console.error осознанно.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { ConfigError, readConfig } from "../_shared/env.ts";
import { HostawayClient } from "../_shared/hostaway.ts";
import { normalizeListing, type PropertyRow } from "../_shared/listing.ts";

const LISTINGS_ENDPOINT = "listings";
const PAGE_SIZE = 100;

interface SkippedListing {
  readonly position: number;
  readonly reason: string;
}

interface RawListingRow {
  readonly id: number;
  readonly data: unknown;
  readonly synced_at: string;
}

interface SyncSummary {
  readonly fetched: number;
  readonly normalized: number;
  readonly skipped: SkippedListing[];
  readonly rawUpserted: number;
  readonly propertiesInserted: number;
  readonly propertiesUpdated: number;
  readonly durationMs: number;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Разбор выгрузки.
 *
 * Одна кривая запись не должна ронять весь прогон: испорченные складываются
 * в skipped и попадают в ответ, остальные доезжают до базы. Молча они при этом
 * не теряются — каждая пишется в журнал.
 */
function normalizeAll(
  listings: readonly unknown[],
  syncedAt: string,
): { properties: PropertyRow[]; raws: RawListingRow[]; skipped: SkippedListing[] } {
  const properties: PropertyRow[] = [];
  const raws: RawListingRow[] = [];
  const skipped: SkippedListing[] = [];

  listings.forEach((listing, position) => {
    try {
      const property = normalizeListing(listing, syncedAt);
      properties.push(property);
      raws.push({ id: property.id, data: listing, synced_at: syncedAt });
    } catch (error: unknown) {
      const reason = getErrorMessage(error);
      skipped.push({ position, reason });
      console.error(`Listing at position ${position} skipped: ${reason}`);
    }
  });

  return { properties, raws, skipped };
}

async function runSync(): Promise<SyncSummary> {
  const startedAt = Date.now();
  const config = readConfig(Deno.env);
  const syncedAt = new Date(startedAt).toISOString();

  const hostaway = new HostawayClient(config.hostaway);
  const listings = await hostaway.listAll(LISTINGS_ENDPOINT, PAGE_SIZE);
  console.info(`Fetched listings from Hostaway: ${listings.length}`);

  const { properties, raws, skipped } = normalizeAll(listings, syncedAt);

  const supabase = createClient(config.supabaseUrl, config.supabaseSecretKey, {
    auth: { persistSession: false },
  });

  const { data, error } = await supabase.rpc("sync_hostaway_listings", {
    raw_rows: raws,
    property_rows: properties,
  });

  if (error) {
    throw new Error(`Database write failed: ${error.message}`);
  }

  const counts = (data ?? {}) as Record<string, number>;

  return {
    fetched: listings.length,
    normalized: properties.length,
    skipped,
    rawUpserted: counts.raw_upserted ?? 0,
    propertiesInserted: counts.properties_inserted ?? 0,
    propertiesUpdated: counts.properties_updated ?? 0,
    durationMs: Date.now() - startedAt,
  };
}

Deno.serve(async () => {
  try {
    const summary = await runSync();
    console.info(
      `Listing sync finished in ${summary.durationMs} ms: ` +
        `inserted ${summary.propertiesInserted}, updated ${summary.propertiesUpdated}, ` +
        `skipped ${summary.skipped.length}`,
    );

    return Response.json({ success: true, data: summary });
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    console.error(`Listing sync failed: ${message}`);

    // Нехватка настроек — вина развёртывания, а не запроса.
    const status = error instanceof ConfigError ? 500 : 502;
    return Response.json({ success: false, error: message }, { status });
  }
});
