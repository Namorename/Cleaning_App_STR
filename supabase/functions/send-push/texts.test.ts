import { assertEquals } from "jsr:@std/assert@1";

import type { Language, Place, PushGroup } from "./batch.ts";
import type { Folded, FoldedTask } from "./fold.ts";
import COPY from "./push-texts.json" with { type: "json" };
import { renderPush } from "./texts.ts";

/**
 * The one server text in the app (CLAUDE.md, «Исключение одно — текст push»):
 * written here, in her language, from a copy of the push.* keys of the shared
 * locales. The copy has to be the locales' own, word for word.
 */

const LOCALES = "../../../packages/shared/src/i18n/locales";

for (const language of ["ru", "en", "cs"] as const) {
  Deno.test(`the ${language} copy is the shared locales' push.* word for word`, async () => {
    const locale = JSON.parse(
      await Deno.readTextFile(new URL(`${LOCALES}/${language}.json`, import.meta.url)),
    );

    assertEquals((COPY as Record<string, unknown>)[language], locale.push);
  });
}

const HOUSE: Place = { name: "Vinohradska House", hostawayUnitId: null, parentName: null };
const ROOM: Place = { name: "1 - 2109", hostawayUnitId: 14002, parentName: "Vinohradska House" };
const FLAT: Place = { name: "Flat C", hostawayUnitId: null, parentName: null };

function group(language: Language): PushGroup {
  return {
    recipientId: "r",
    collapseKey: "task:t",
    language,
    tokens: [],
    places: new Map([
      ["900001", HOUSE],
      ["1000000014002", ROOM],
      ["900003", FLAT],
    ]),
    rows: [],
  };
}

function day(date: string, language: Language): string {
  const locales = { ru: "ru-RU", en: "en-GB", cs: "cs-CZ" } as const;
  const [year, month, dayOfMonth] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(locales[language], {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(Date.UTC(year, month - 1, dayOfMonth));
}

function task(overrides: Partial<FoldedTask>): Folded {
  return {
    type: "task",
    event: "cleaning_assigned",
    taskId: "t",
    jobType: "cleaning",
    date: "2026-10-02",
    propertyId: "1000000014002",
    urgent: false,
    ...overrides,
  };
}

Deno.test("an assignment names the house and the room in it, and the day", () => {
  assertEquals(renderPush(task({}), group("ru")), {
    title: "Вам назначена уборка",
    body: `Vinohradska House — 1 - 2109, ${day("2026-10-02", "ru")}`,
  });
});

Deno.test("a repair is work, not a cleaning, in every language", () => {
  const repair = task({ jobType: "maintenance", propertyId: "900003" });

  assertEquals(renderPush(repair, group("ru")).title, "Вам назначена работа");
  assertEquals(renderPush(repair, group("en")).title, "Job assigned to you");
  assertEquals(renderPush(repair, group("cs")).title, "Máte přidělenou práci");
});

Deno.test("a midstay cleaning is a cleaning", () => {
  assertEquals(
    renderPush(task({ jobType: "midstay" }), group("en")).title,
    "Cleaning assigned to you",
  );
});

Deno.test("a move says from when to when, and who moved it", () => {
  const moved = task({
    event: "cleaning_moved",
    date: "2026-10-05",
    propertyId: "900003",
    move: {
      fromDate: "2026-10-02",
      toDate: "2026-10-05",
      fromPropertyId: "900003",
      toPropertyId: "900003",
      by: "office",
    },
  });

  assertEquals(renderPush(moved, group("ru")), {
    title: "Уборка перенесена",
    body: `Flat C: ${day("2026-10-02", "ru")} → ${day("2026-10-05", "ru")}. Перенёс менеджер.`,
  });
});

Deno.test("a move to another flat on the same day names both flats", () => {
  const moved = task({
    event: "cleaning_moved",
    propertyId: "900001",
    move: {
      fromDate: "2026-10-02",
      toDate: "2026-10-02",
      fromPropertyId: "900003",
      toPropertyId: "900001",
      by: "booking",
    },
  });

  assertEquals(
    renderPush(moved, group("en")).body,
    `Flat C → Vinohradska House, ${day("2026-10-02", "en")}. The booking changed.`,
  );
});

Deno.test("a move of both day and flat names all four", () => {
  const moved = task({
    event: "cleaning_moved",
    move: {
      fromDate: "2026-10-02",
      toDate: "2026-10-03",
      fromPropertyId: "900003",
      toPropertyId: "1000000014002",
      by: "booking",
    },
  });

  assertEquals(
    renderPush(moved, group("cs")).body,
    `Flat C, ${day("2026-10-02", "cs")} → Vinohradska House — 1 - 2109, ` +
      `${day("2026-10-03", "cs")}. Změnila se rezervace.`,
  );
});

Deno.test("new hours give the window, or the end of it she has", () => {
  const window = (from: string | null, to: string | null) =>
    renderPush(
      task({ event: "cleaning_window", propertyId: "900003", window: { from, to } }),
      group("ru"),
    ).body;

  assertEquals(window("11:00", "15:00"), `Flat C, ${day("2026-10-02", "ru")}: 11:00–15:00`);
  assertEquals(window("11:00", null), `Flat C, ${day("2026-10-02", "ru")}: с 11:00`);
  assertEquals(window(null, "15:00"), `Flat C, ${day("2026-10-02", "ru")}: до 15:00`);
});

Deno.test("a booking cancelled while she cleans tells her to ask the office", () => {
  assertEquals(
    renderPush(task({ event: "booking_cancelled_live", propertyId: "900003" }), group("ru")).body,
    "Flat C: бронь отменена, пока идёт уборка. Уточните у менеджера.",
  );
});

Deno.test("messages are counted in the grammar of her language, and never quoted", () => {
  const chat = (count: number, language: Language) =>
    renderPush(
      { type: "chat", count, author: "Bara", subject: "task", subjectId: "t", propertyId: "900003" },
      group(language),
    );

  assertEquals(chat(1, "ru"), { title: "Новое сообщение", body: "Flat C · Bara" });
  assertEquals(chat(3, "ru").title, "3 новых сообщения");
  assertEquals(chat(5, "ru").title, "5 новых сообщений");
  assertEquals(chat(21, "ru").title, "21 новое сообщение");
  assertEquals(chat(3, "cs").title, "3 nové zprávy");
  assertEquals(chat(5, "cs").title, "5 nových zpráv");
  assertEquals(chat(1, "en").title, "New message");
  assertEquals(chat(3, "en").title, "3 new messages");
});

Deno.test("a message from nobody known names only the flat", () => {
  assertEquals(
    renderPush(
      { type: "chat", count: 1, author: null, subject: "problem", subjectId: "p", propertyId: "900003" },
      group("en"),
    ).body,
    "Flat C",
  );
});

Deno.test("the morning summary says what there is, and leaves out what there is not", () => {
  const digest = (today: number, newInWeek: number) =>
    renderPush({ type: "digest", today, newInWeek }, group("ru"));

  assertEquals(digest(2, 1), { title: "Ваш день", body: "Сегодня: 2 · Новых на неделе: 1" });
  assertEquals(digest(2, 0).body, "Сегодня: 2");
  assertEquals(digest(0, 3).body, "Новых на неделе: 3");
});

Deno.test("a flat whose name did not come is called by its number", () => {
  assertEquals(
    renderPush(task({ propertyId: "424242" }), group("cs")).body,
    `Objekt 424242, ${day("2026-10-02", "cs")}`,
  );
});
