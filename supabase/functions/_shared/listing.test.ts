import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { normalizeListing } from "./listing.ts";

const SYNCED_AT = "2026-08-27T16:00:00.000Z";

/** Слепок реального ответа Hostaway, урезанный до значимых полей (в живом — 145). */
function makeListing(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 98352,
    name: "Billionaires Club 5BD | Sauna | heart of prague",
    internalListingName: "CZ - Brehova old Apt 51 Fl.5  8G 6BR 2B",
    address: "Břehová 208 5 floor",
    city: "Praha 1",
    countryCode: "CZ",
    state: "Hlavní město Praha",
    zipcode: "110 00",
    timeZoneName: "Europe/Prague",
    bedroomsNumber: 5,
    bathroomsNumber: 2,
    personCapacity: 8,
    propertyTypeId: 9,
    ...overrides,
  };
}

Deno.test("нормализует полный листинг в строку properties", () => {
  const row = normalizeListing(makeListing(), SYNCED_AT);

  assertEquals(row, {
    id: 98352,
    name: "CZ - Brehova old Apt 51 Fl.5  8G 6BR 2B",
    address: "Břehová 208 5 floor",
    city: "Praha 1",
    country_code: "CZ",
    timezone: "Europe/Prague",
    bedrooms: 5,
    bathrooms: 2,
    max_guests: 8,
    synced_at: SYNCED_AT,
  });
});

Deno.test("предпочитает internalListingName маркетинговому name", () => {
  // Клинер ищет объект по внутреннему коду, а не по рекламному заголовку.
  const row = normalizeListing(makeListing(), SYNCED_AT);
  assertEquals(row.name, "CZ - Brehova old Apt 51 Fl.5  8G 6BR 2B");
});

Deno.test("откатывается на name, когда internalListingName пуст", () => {
  for (const empty of [null, "", "   ", undefined]) {
    const row = normalizeListing(makeListing({ internalListingName: empty }), SYNCED_AT);
    assertEquals(row.name, "Billionaires Club 5BD | Sauna | heart of prague");
  }
});

Deno.test("подставляет UTC, когда часовой пояс не пришёл", () => {
  // timezone в схеме NOT NULL: дедлайны уборок считаются в локальном времени объекта.
  const row = normalizeListing(makeListing({ timeZoneName: null }), SYNCED_AT);
  assertEquals(row.timezone, "UTC");
});

Deno.test("приводит числовые поля, пришедшие строками", () => {
  // Hostaway для части объектов отдаёт числа строками.
  const row = normalizeListing(
    makeListing({ id: "98352", bedroomsNumber: "5", personCapacity: "8" }),
    SYNCED_AT,
  );

  assertEquals(row.id, 98352);
  assertEquals(row.bedrooms, 5);
  assertEquals(row.max_guests, 8);
});

Deno.test("отсутствующие количества дают null, а не ноль", () => {
  // Ноль спален — осмысленное значение (студия), поэтому «неизвестно» им подменять нельзя.
  const row = normalizeListing(
    makeListing({ bedroomsNumber: null, bathroomsNumber: undefined, personCapacity: "" }),
    SYNCED_AT,
  );

  assertEquals(row.bedrooms, null);
  assertEquals(row.bathrooms, null);
  assertEquals(row.max_guests, null);
});

Deno.test("сохраняет ноль спален как ноль", () => {
  const row = normalizeListing(makeListing({ bedroomsNumber: 0 }), SYNCED_AT);
  assertEquals(row.bedrooms, 0);
});

Deno.test("пустые строки адреса превращаются в null", () => {
  const row = normalizeListing(
    makeListing({ address: "", city: "   ", countryCode: null }),
    SYNCED_AT,
  );

  assertEquals(row.address, null);
  assertEquals(row.city, null);
  assertEquals(row.country_code, null);
});

Deno.test("дробное число ванных сохраняется", () => {
  const row = normalizeListing(makeListing({ bathroomsNumber: 2.5 }), SYNCED_AT);
  assertEquals(row.bathrooms, 2.5);
});

Deno.test("не переносит is_active: Hostaway такого поля не отдаёт", () => {
  // Синк не должен затирать ручную деактивацию объекта в панели менеджера.
  const row = normalizeListing(makeListing(), SYNCED_AT) as unknown as Record<string, unknown>;
  assertEquals("is_active" in row, false);
});

Deno.test("падает на листинге без пригодного id", () => {
  for (const badId of [null, undefined, "", "не-число", {}, []]) {
    assertThrows(
      () => normalizeListing(makeListing({ id: badId }), SYNCED_AT),
      Error,
      "id",
    );
  }
});

Deno.test("падает на листинге без единого имени", () => {
  assertThrows(
    () => normalizeListing(makeListing({ name: null, internalListingName: null }), SYNCED_AT),
    Error,
    "98352",
  );
});

Deno.test("падает, когда пришёл не объект", () => {
  for (const notAnObject of [null, undefined, 42, "строка", [], true]) {
    assertThrows(() => normalizeListing(notAnObject, SYNCED_AT), Error);
  }
});
