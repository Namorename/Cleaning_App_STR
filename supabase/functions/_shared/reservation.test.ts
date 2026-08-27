import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { normalizeReservation } from "./reservation.ts";

const SYNCED_AT = "2026-08-27T18:00:00.000Z";

/** Слепок реального ответа Hostaway, урезанный до значимых полей (в живом — 137). */
function makeReservation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 65289672,
    listingMapId: 495979,
    channelId: 2018,
    channelName: "airbnbOfficial",
    status: "modified",
    guestName: "Тестовый Гость",
    arrivalDate: "2026-08-28",
    departureDate: "2026-08-31",
    numberOfGuests: 5,
    totalPrice: 6948.4,
    isManuallyChecked: 0,
    ...overrides,
  };
}

Deno.test("нормализует полную бронь в строку reservations", () => {
  const row = normalizeReservation(makeReservation(), SYNCED_AT);

  assertEquals(row, {
    id: 65289672,
    property_id: 495979,
    arrival_date: "2026-08-28",
    departure_date: "2026-08-31",
    status: "modified",
    channel_id: 2018,
    guest_name: "Тестовый Гость",
    guests_count: 5,
    total_price: 6948.4,
    is_block: false,
    synced_at: SYNCED_AT,
  });
});

Deno.test("listingMapId становится property_id", () => {
  const row = normalizeReservation(makeReservation({ listingMapId: 98352 }), SYNCED_AT);
  assertEquals(row.property_id, 98352);
});

// ---------------------------------------------------------------------------
//  is_block: единственный однозначный сигнал — статус ownerStay
// ---------------------------------------------------------------------------

Deno.test("ownerStay помечается блокировкой", () => {
  const row = normalizeReservation(makeReservation({ status: "ownerStay" }), SYNCED_AT);
  assertEquals(row.is_block, true);
});

Deno.test("обычные статусы блокировкой не считаются", () => {
  const statuses = ["new", "modified", "cancelled", "expired", "inquiry", "inquiryPreapproved"];
  for (const status of statuses) {
    const row = normalizeReservation(makeReservation({ status }), SYNCED_AT);
    assertEquals(row.is_block, false, `статус ${status} ошибочно помечен блокировкой`);
  }
});

Deno.test("прямой канал с нулевой ценой блокировкой НЕ считается", () => {
  // На живых данных под channelId=2000 нашлись промо-показы и фотосъёмки:
  // 'andrej promo show', цена 0, статус modified. Люди в квартире были,
  // уборка нужна. Пропустить нужную уборку хуже, чем сделать лишнюю,
  // поэтому по каналу и цене блокировку не выводим.
  const row = normalizeReservation(
    makeReservation({ channelId: 2000, totalPrice: 0, guestName: "andrej promo show" }),
    SYNCED_AT,
  );
  assertEquals(row.is_block, false);
});

Deno.test("имя гостя блокировку не определяет", () => {
  // Встречались 'block', 'Upgrade', 'Foceni', 'NY Block' — произвольный текст,
  // опираться на него нельзя.
  for (const guestName of ["block", "Upgrade", "NY Block"]) {
    const row = normalizeReservation(makeReservation({ guestName }), SYNCED_AT);
    assertEquals(row.is_block, false, `имя ${guestName} не должно влиять на is_block`);
  }
});

Deno.test("неизвестный статус сохраняется как есть", () => {
  // Hostaway обещает добавлять новые значения — падать на них нельзя.
  const row = normalizeReservation(makeReservation({ status: "somethingNew" }), SYNCED_AT);
  assertEquals(row.status, "somethingNew");
  assertEquals(row.is_block, false);
});

// ---------------------------------------------------------------------------
//  Приведение типов
// ---------------------------------------------------------------------------

Deno.test("числа, пришедшие строками, приводятся", () => {
  const row = normalizeReservation(
    makeReservation({
      id: "65289672",
      listingMapId: "495979",
      numberOfGuests: "5",
      totalPrice: "6948.40",
    }),
    SYNCED_AT,
  );

  assertEquals(row.id, 65289672);
  assertEquals(row.property_id, 495979);
  assertEquals(row.guests_count, 5);
  assertEquals(row.total_price, 6948.4);
});

Deno.test("нулевая цена сохраняется как ноль, а не как null", () => {
  const row = normalizeReservation(makeReservation({ totalPrice: 0 }), SYNCED_AT);
  assertEquals(row.total_price, 0);
});

Deno.test("отсутствующие необязательные поля дают null", () => {
  const row = normalizeReservation(
    makeReservation({
      channelId: null,
      guestName: "  ",
      numberOfGuests: "",
      totalPrice: undefined,
    }),
    SYNCED_AT,
  );

  assertEquals(row.channel_id, null);
  assertEquals(row.guest_name, null);
  assertEquals(row.guests_count, null);
  assertEquals(row.total_price, null);
});

// ---------------------------------------------------------------------------
//  Проверки на границе
// ---------------------------------------------------------------------------

Deno.test("нулевой интервал допускается", () => {
  // Hostaway отдаёт такое для части блокировок; констрейнт схемы это разрешает.
  const row = normalizeReservation(
    makeReservation({ arrivalDate: "2026-09-10", departureDate: "2026-09-10" }),
    SYNCED_AT,
  );
  assertEquals(row.arrival_date, row.departure_date);
});

Deno.test("выезд раньше заезда отвергается", () => {
  // Такая строка уронила бы весь батч на констрейнте — отсекаем на границе.
  assertThrows(
    () =>
      normalizeReservation(
        makeReservation({ arrivalDate: "2026-09-10", departureDate: "2026-09-01" }),
        SYNCED_AT,
      ),
    Error,
    "65289672",
  );
});

Deno.test("падает на нераспознаваемой дате", () => {
  for (const bad of ["не-дата", "2026-13-45", "", null, 20260828]) {
    assertThrows(
      () => normalizeReservation(makeReservation({ arrivalDate: bad }), SYNCED_AT),
      Error,
      "arrivalDate",
    );
  }
});

Deno.test("падает без пригодного id", () => {
  for (const bad of [null, "", "не-число", {}, []]) {
    assertThrows(() => normalizeReservation(makeReservation({ id: bad }), SYNCED_AT), Error, "id");
  }
});

Deno.test("падает без listingMapId: бронь без объекта бессмысленна", () => {
  assertThrows(
    () => normalizeReservation(makeReservation({ listingMapId: null }), SYNCED_AT),
    Error,
    "listingMapId",
  );
});

Deno.test("падает, когда пришёл не объект", () => {
  for (const bad of [null, undefined, 42, "строка", [], true]) {
    assertThrows(() => normalizeReservation(bad, SYNCED_AT), Error);
  }
});
