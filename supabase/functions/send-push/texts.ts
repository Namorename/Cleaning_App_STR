/**
 * The text of a push, in her language.
 *
 * The one place a server writes words for a person (CLAUDE.md, «Исключение
 * одно — текст push»): the system shows a push while the app is closed, and
 * there is nothing on the phone to translate it then. The words come from
 * push-texts.json, a copy of the push.* keys of the shared locales that
 * texts.test.ts holds to them word for word — the function is deployed on
 * its own, and a copy in its folder keeps it from depending on anything
 * outside it.
 *
 * A message is never quoted: the lock screen shows the flat and who wrote,
 * not what (owner's word 2).
 */

import type { Language, Place, PushGroup } from "./batch.ts";
import type { Folded, FoldedChat, FoldedDigest, FoldedTask } from "./fold.ts";
import COPY from "./push-texts.json" with { type: "json" };

export interface PushText {
  readonly title: string;
  readonly body: string;
}

type Texts = Readonly<Record<string, unknown>>;

/** The same as INTL_LOCALES in packages/shared/src/i18n. */
const INTL_LOCALES: Readonly<Record<Language, string>> = {
  ru: "ru-RU",
  en: "en-GB",
  cs: "cs-CZ",
};

/** How the shared place rule writes a room inside its house (property-path.ts). */
const PROPERTY_PATH_SEPARATOR = " — ";

/** A cleaning and a mid-stay cleaning are called what they are; the rest is work. */
const CLEANING_KINDS: ReadonlySet<string> = new Set(["cleaning", "midstay"]);

function textsFor(language: Language): Texts {
  return (COPY as Readonly<Record<Language, Texts>>)[language];
}

/** A key like "cleaning_moved.byOffice", read out of the copy. */
function lookup(texts: Texts, key: string): string {
  const value = key.split(".").reduce<unknown>(
    (node, part) => (typeof node === "object" && node !== null ? (node as Texts)[part] : undefined),
    texts,
  );
  if (typeof value !== "string") {
    throw new Error(`Missing push text ${key}`);
  }
  return value;
}

function fill(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(
    /\{\{(\w+)\}\}/g,
    (whole, name: string) => (name in values ? String(values[name]) : whole),
  );
}

function say(
  texts: Texts,
  key: string,
  values: Readonly<Record<string, string | number>> = {},
): string {
  return fill(lookup(texts, key), values);
}

/** A YYYY-MM-DD day, as a calendar day: "пт, 2 окт.", "Fri 2 Oct", "pá 2. 10.". */
function formatDay(date: string | null, language: Language): string {
  if (date === null) {
    return "";
  }
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(INTL_LOCALES[language], {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(Date.UTC(year, month - 1, day));
}

function placeName(texts: Texts, places: ReadonlyMap<string, Place>, id: string | null): string {
  if (id === null) {
    return "";
  }
  const place = places.get(id);
  if (place === undefined) {
    return say(texts, "unknownPlace", { id });
  }
  return place.parentName !== null && place.hostawayUnitId !== null
    ? `${place.parentName}${PROPERTY_PATH_SEPARATOR}${place.name}`
    : place.name;
}

function taskTitle(texts: Texts, folded: FoldedTask): string {
  const isCleaning = folded.jobType === null || CLEANING_KINDS.has(folded.jobType);
  return say(texts, `${folded.event}.${isCleaning ? "title" : "titleWork"}`);
}

function moveBody(texts: Texts, folded: FoldedTask, group: PushGroup): string {
  const move = folded.move;
  if (move === undefined) {
    return "";
  }
  const language = group.language;
  const from = formatDay(move.fromDate, language);
  const to = formatDay(move.toDate, language);
  const fromPlace = placeName(texts, group.places, move.fromPropertyId);
  const toPlace = placeName(texts, group.places, move.toPropertyId);
  let where: string;
  if (move.fromPropertyId === move.toPropertyId) {
    where = say(texts, "moveDays", { place: toPlace, from, to });
  } else if (move.fromDate === move.toDate) {
    where = say(texts, "movePlaces", { from: fromPlace, to: toPlace, date: to });
  } else {
    where = say(texts, "moveBoth", { fromPlace, fromDate: from, toPlace, toDate: to });
  }
  const who = say(
    texts,
    move.by === "office" ? "cleaning_moved.byOffice" : "cleaning_moved.byBooking",
  );
  return `${where}. ${who}`;
}

function windowText(texts: Texts, folded: FoldedTask): string {
  const { from, to } = folded.window ?? { from: null, to: null };
  if (from !== null && to !== null) {
    return say(texts, "windowRange", { from, to });
  }
  if (from !== null) {
    return say(texts, "windowFrom", { time: from });
  }
  return to === null ? "" : say(texts, "windowUntil", { time: to });
}

function renderTask(texts: Texts, folded: FoldedTask, group: PushGroup): PushText {
  const place = placeName(texts, group.places, folded.propertyId);
  const date = formatDay(folded.date, group.language);
  const title = taskTitle(texts, folded);
  switch (folded.event) {
    case "cleaning_moved":
      return { title, body: moveBody(texts, folded, group) };
    case "cleaning_window":
      return {
        title,
        body: say(texts, "windowBody", { place, date, window: windowText(texts, folded) }),
      };
    case "booking_cancelled_live":
      return {
        title: say(texts, "booking_cancelled_live.title"),
        body: say(texts, "booking_cancelled_live.body", { place }),
      };
    default:
      return { title, body: say(texts, "placeDay", { place, date }) };
  }
}

/** One message is "a new message"; more are counted in her grammar. */
function renderChat(texts: Texts, folded: FoldedChat, group: PushGroup): PushText {
  const form = new Intl.PluralRules(INTL_LOCALES[group.language]).select(folded.count);
  const title = folded.count === 1
    ? say(texts, "chat_message.title")
    : say(texts, `chat_message.count_${form}`, { count: folded.count });
  const place = placeName(texts, group.places, folded.propertyId);
  const body = folded.author === null
    ? place
    : say(texts, "messageFrom", { place, author: folded.author });
  return { title, body };
}

function renderDigest(texts: Texts, folded: FoldedDigest): PushText {
  const parts = [
    ...(folded.today > 0 ? [say(texts, "daily_digest.today", { count: folded.today })] : []),
    ...(folded.newInWeek > 0
      ? [say(texts, "daily_digest.newInWeek", { count: folded.newInWeek })]
      : []),
  ];
  return { title: say(texts, "daily_digest.title"), body: parts.join(" · ") };
}

export function renderPush(folded: Folded, group: PushGroup): PushText {
  const texts = textsFor(group.language);
  switch (folded.type) {
    case "task":
      return renderTask(texts, folded, group);
    case "chat":
      return renderChat(texts, folded, group);
    case "digest":
      return renderDigest(texts, folded);
  }
}
