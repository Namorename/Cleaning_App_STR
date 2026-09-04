/**
 * Нормализация брони Hostaway в строку таблицы public.reservations.
 *
 * Про is_block. Надёжного признака «это блокировка календаря, а не заезд
 * гостя» Hostaway не даёт — выяснено на живых данных:
 *   - channelId = 2000 (прямой канал) содержит вперемешку промо-показы,
 *     фотосъёмки, хозяйские заезды и настоящие отменённые брони с ценой;
 *   - имя гостя произвольное: 'block', 'Upgrade', 'Foceni', 'NY Block';
 *   - нулевая цена встречается и у промо-заездов, где люди в квартире были.
 *
 * Поэтому здесь помечается только один однозначный случай — статус ownerStay.
 * Пропустить нужную уборку хуже, чем сделать лишнюю, так что по каналу и цене
 * блокировку не выводим. Остальную политику применяет генератор задач в F4,
 * опираясь на сохранённые status и total_price.
 */

import { isRecord, toFiniteNumber, toIsoDate, toTrimmedString } from "./coerce.ts";

/** Единственный статус, однозначно означающий занятость без гостя. */
const BLOCK_STATUS = "ownerStay";

export interface ReservationRow {
  id: number;
  property_id: number;
  arrival_date: string;
  departure_date: string;
  status: string;
  channel_id: number | null;
  guest_name: string | null;
  guests_count: number | null;
  total_price: number | null;
  is_block: boolean;
  check_in_time: string | null;
  check_out_time: string | null;
  synced_at: string;
}

/**
 * Час брони Hostaway в значение колонки `time`.
 *
 * Hostaway отдаёт checkInTime / checkOutTime целыми часами (0-23) — проверено
 * на 1704 живых бронях, минут не бывает ни разу. Всё, что не целый час суток,
 * считается отсутствующим: окно тогда возьмётся у объекта.
 *
 * Ноль сохраняется как 00:00, а не выбрасывается. Он означает «канал времени
 * не сообщил», но решение об этом принимает одна функция в базе
 * (public.reservation_cleaning_window) — здесь записывается то, что прислал
 * Hostaway, без трактовки.
 */
function toHourTime(value: unknown): string | null {
  const hour = toFiniteNumber(value);
  if (hour === null || !Number.isInteger(hour) || hour < 0 || hour > 23) {
    return null;
  }

  return `${String(hour).padStart(2, "0")}:00`;
}

export function normalizeReservation(raw: unknown, syncedAt: string): ReservationRow {
  if (!isRecord(raw)) {
    throw new TypeError(`Hostaway reservation must be an object, got: ${typeof raw}`);
  }

  const id = toFiniteNumber(raw.id);
  if (id === null) {
    throw new TypeError(
      `Hostaway reservation has no usable id: got ${JSON.stringify(raw.id) ?? "undefined"}`,
    );
  }

  // listingMapId — ссылка на объект. Бронь без объекта некуда привязать,
  // и внешний ключ всё равно отверг бы такую строку.
  const propertyId = toFiniteNumber(raw.listingMapId);
  if (propertyId === null) {
    throw new TypeError(`Reservation ${id}: listingMapId is missing or unreadable`);
  }

  const status = toTrimmedString(raw.status);
  if (status === null) {
    throw new TypeError(`Reservation ${id}: status is empty`);
  }

  const arrivalDate = toIsoDate(raw.arrivalDate, "arrivalDate");
  const departureDate = toIsoDate(raw.departureDate, "departureDate");

  // Схема допускает нулевой интервал, но не обратный. Отсекаем здесь, иначе
  // одна такая строка уронила бы на констрейнте весь батч синхронизации.
  if (departureDate < arrivalDate) {
    throw new RangeError(
      `Reservation ${id}: departure ${departureDate} precedes arrival ${arrivalDate}`,
    );
  }

  return {
    id,
    property_id: propertyId,
    arrival_date: arrivalDate,
    departure_date: departureDate,
    status,
    channel_id: toFiniteNumber(raw.channelId),
    guest_name: toTrimmedString(raw.guestName),
    guests_count: toFiniteNumber(raw.numberOfGuests),
    total_price: toFiniteNumber(raw.totalPrice),
    is_block: status === BLOCK_STATUS,
    check_in_time: toHourTime(raw.checkInTime),
    check_out_time: toHourTime(raw.checkOutTime),
    synced_at: syncedAt,
  };
}
