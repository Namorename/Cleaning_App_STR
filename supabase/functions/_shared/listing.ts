/**
 * Нормализация листинга Hostaway в строку таблицы public.properties.
 *
 * Вход — чужой фид: 145 полей, часть из которых приходит строками вместо чисел,
 * пустыми строками вместо null и вовсе отсутствует у отдельных объектов.
 * Поэтому вход типизирован как unknown и сужается явно, а не приводится через as.
 */

import { isRecord, toFiniteNumber, toTrimmedString } from "./coerce.ts";

/** Схема БД требует timezone NOT NULL: дедлайны уборок считаются в локальном времени объекта. */
const DEFAULT_TIMEZONE = "UTC";

export interface PropertyRow {
  id: number;
  name: string;
  address: string | null;
  city: string | null;
  country_code: string | null;
  timezone: string;
  bedrooms: number | null;
  bathrooms: number | null;
  max_guests: number | null;
  synced_at: string;
}

/**
 * Имя объекта для исполнителя.
 *
 * internalListingName — рабочий код вида "CZ - Brehova old Apt 51 Fl.5 8G 6BR 2B",
 * name — маркетинговый заголовок объявления. В списке задач клинеру нужен первый.
 */
function pickName(listing: Record<string, unknown>): string | null {
  return toTrimmedString(listing.internalListingName) ?? toTrimmedString(listing.name);
}

/**
 * Обратите внимание: is_active в результат НЕ попадает. Hostaway такого поля не
 * отдаёт, а перезапись значением по умолчанию затирала бы ручную деактивацию
 * объекта в панели менеджера при каждом прогоне синхронизации.
 */
export function normalizeListing(raw: unknown, syncedAt: string): PropertyRow {
  if (!isRecord(raw)) {
    throw new TypeError(
      `Hostaway listing must be an object, got: ${typeof raw}`,
    );
  }

  const id = toFiniteNumber(raw.id);
  if (id === null) {
    throw new TypeError(
      `Hostaway listing has no usable id: got ${JSON.stringify(raw.id) ?? "undefined"}`,
    );
  }

  const name = pickName(raw);
  if (name === null) {
    throw new TypeError(
      `Hostaway listing ${id} has neither internalListingName nor name`,
    );
  }

  return {
    id,
    name,
    address: toTrimmedString(raw.address),
    city: toTrimmedString(raw.city),
    country_code: toTrimmedString(raw.countryCode),
    timezone: toTrimmedString(raw.timeZoneName) ?? DEFAULT_TIMEZONE,
    bedrooms: toFiniteNumber(raw.bedroomsNumber),
    bathrooms: toFiniteNumber(raw.bathroomsNumber),
    max_guests: toFiniteNumber(raw.personCapacity),
    synced_at: syncedAt,
  };
}
