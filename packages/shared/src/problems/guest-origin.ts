/**
 * Where a task from a guest came from (problem_guest_origin, 20261111120000), in the words of the
 * screen's language. The panel and the phone say it alike, line by line (owner, 2026-11-11): the stay,
 * the guest, the channel and the rating, the day the guest sent it, and the PMS's numbers to find it
 * in Hostaway. Which lines a person gets is the server's to decide — a key it leaves out is a line
 * this person may not see, and nothing here asks for it.
 *
 * The guest's name is never stored: the server reads it from the booking when the page asks, and
 * the apps keep it in memory only.
 */
import { INTL_LOCALES, isSupportedLanguage } from '../i18n';
import type { Translate } from './closing';

/** Why the name is or is not there (see the function's comment in the migration). */
export const GUEST_NAME_STATES = ['shown', 'erased', 'cut', 'none'] as const;
export type GuestNameState = (typeof GUEST_NAME_STATES)[number];

export type DatePrecision = 'day' | 'month';

/** The stay: dates (YYYY-MM-DD) while the signal keeps them, months (YYYY-MM) after the cut. */
export interface GuestStay {
  readonly precision: DatePrecision;
  readonly arrival: string | null;
  readonly departure: string | null;
}

export interface GuestOrigin {
  readonly source: 'review' | 'message';
  readonly stay: GuestStay | null;
  /** The head technician and the office. */
  readonly channel?: string | null;
  readonly guest?: { readonly state: GuestNameState; readonly name: string | null };
  readonly rating?: number | null;
  readonly sent?: { readonly precision: DatePrecision; readonly on: string } | null;
  /** The office alone. */
  readonly booking_id?: string | null;
  readonly conversation_id?: string | null;
  readonly signal_id?: string | null;
  readonly has_text?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function precisionOf(value: unknown): DatePrecision | null {
  return value === 'day' || value === 'month' ? value : null;
}

function readStay(value: unknown): GuestStay | null {
  if (!isRecord(value)) {
    return null;
  }
  const precision = precisionOf(value.precision);
  return precision === null
    ? null
    : { precision, arrival: textOrNull(value.arrival), departure: textOrNull(value.departure) };
}

function readGuest(value: unknown): GuestOrigin['guest'] {
  if (!isRecord(value)) {
    return undefined;
  }
  const state = (GUEST_NAME_STATES as readonly unknown[]).includes(value.state)
    ? (value.state as GuestNameState)
    : 'none';
  const name = state === 'shown' ? textOrNull(value.name) : null;
  return { state: name === null && state === 'shown' ? 'none' : state, name };
}

function readSent(value: unknown): GuestOrigin['sent'] {
  if (!isRecord(value)) {
    return null;
  }
  const precision = precisionOf(value.precision);
  const on = textOrNull(value.on);
  return precision === null || on === null ? null : { precision, on };
}

/**
 * The server's answer read field by field: a value a newer server spells differently costs that
 * line, not the page. Null when it is no answer about a guest at all (a report of the staff, a task
 * the caller may not read).
 */
export function readGuestOrigin(value: unknown): GuestOrigin | null {
  if (!isRecord(value) || (value.source !== 'review' && value.source !== 'message')) {
    return null;
  }
  const origin: { -readonly [K in keyof GuestOrigin]: GuestOrigin[K] } = {
    source: value.source,
    stay: readStay(value.stay),
  };
  if ('channel' in value) {
    origin.channel = textOrNull(value.channel);
  }
  if ('guest' in value) {
    origin.guest = readGuest(value.guest);
  }
  if ('rating' in value) {
    origin.rating = typeof value.rating === 'number' ? value.rating : null;
  }
  if ('sent' in value) {
    origin.sent = readSent(value.sent);
  }
  if ('booking_id' in value) {
    origin.booking_id = textOrNull(value.booking_id);
  }
  if ('conversation_id' in value) {
    origin.conversation_id = textOrNull(value.conversation_id);
  }
  if ('signal_id' in value) {
    origin.signal_id = textOrNull(value.signal_id);
  }
  if ('has_text' in value) {
    origin.has_text = value.has_text === true;
  }
  return origin;
}

function localeOf(language: string): string {
  return isSupportedLanguage(language) ? INTL_LOCALES[language] : INTL_LOCALES.en;
}

/** «5 окт. 2026 г.» for a day, «октябрь 2026 г.» for a month; the value as given if it is neither. */
export function formatGuestDate(value: string, precision: DatePrecision, language: string): string {
  const pattern = precision === 'day' ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}$/;
  if (!pattern.test(value)) {
    return value;
  }
  const at = new Date(precision === 'day' ? `${value}T00:00:00Z` : `${value}-01T00:00:00Z`);
  const options: Intl.DateTimeFormatOptions =
    precision === 'day'
      ? { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }
      : { month: 'long', year: 'numeric', timeZone: 'UTC' };
  return new Intl.DateTimeFormat(localeOf(language), options).format(at);
}

/** One line of the block; `muted` for a line that says why something is not shown. */
export interface GuestOriginLine {
  readonly key: 'stay' | 'months' | 'guest' | 'channel' | 'sent' | 'booking' | 'conversation';
  readonly text: string;
  readonly muted: boolean;
}

function stayLine(stay: GuestStay | null, t: Translate, language: string): GuestOriginLine {
  if (stay === null || (stay.arrival === null && stay.departure === null)) {
    return { key: 'stay', text: t('problems.origin.stayUnknown'), muted: true };
  }
  const from = stay.arrival === null ? '—' : formatGuestDate(stay.arrival, stay.precision, language);
  const to = stay.departure === null ? '—' : formatGuestDate(stay.departure, stay.precision, language);
  const text =
    stay.precision === 'month' && stay.arrival === stay.departure
      ? t('problems.origin.stayIn', { month: from })
      : t('problems.origin.stay', { from, to });
  return { key: 'stay', text, muted: false };
}

const GUEST_WORDS: Readonly<Record<Exclude<GuestNameState, 'shown'>, string>> = {
  erased: 'problems.origin.guestErased',
  cut: 'problems.origin.guestCut',
  none: 'problems.origin.guestNone',
};

function guestLine(guest: NonNullable<GuestOrigin['guest']>, t: Translate): GuestOriginLine {
  return guest.state === 'shown' && guest.name !== null
    ? { key: 'guest', text: t('problems.origin.guest', { name: guest.name }), muted: false }
    : { key: 'guest', text: t(GUEST_WORDS[guest.state === 'shown' ? 'none' : guest.state]), muted: true };
}

function channelLine(origin: GuestOrigin, t: Translate): GuestOriginLine | null {
  if (origin.channel === undefined || origin.channel === null) {
    return null;
  }
  const channel = t(`panel.guests.channel.${origin.channel}`);
  const hasRating =
    origin.source === 'review' && origin.rating !== undefined && origin.rating !== null;
  const text = hasRating
    ? `${channel} · ${t('problems.origin.rating', { rating: String(origin.rating) })}`
    : channel;
  return { key: 'channel', text, muted: false };
}

/**
 * The block's lines, in the order both apps show them. The stay always; the guest, the channel and
 * the day it was sent where the server gave them; the numbers to find it in Hostaway for the office.
 * Where the stay is only months and no guest line says why, a line says it.
 */
export function guestOriginLines(
  origin: GuestOrigin,
  t: Translate,
  language: string,
): readonly GuestOriginLine[] {
  const lines: GuestOriginLine[] = [stayLine(origin.stay, t, language)];
  if (origin.guest !== undefined) {
    lines.push(guestLine(origin.guest, t));
  } else if (origin.stay?.precision === 'month') {
    lines.push({ key: 'months', text: t('problems.origin.monthsOnly'), muted: true });
  }
  const channel = channelLine(origin, t);
  if (channel !== null) {
    lines.push(channel);
  }
  if (origin.sent !== undefined && origin.sent !== null) {
    const date = formatGuestDate(origin.sent.on, origin.sent.precision, language);
    const word =
      origin.source === 'review' ? 'problems.origin.reviewSent' : 'problems.origin.messageSent';
    lines.push({ key: 'sent', text: t(word, { date }), muted: false });
  }
  if (origin.booking_id !== undefined && origin.booking_id !== null) {
    lines.push({
      key: 'booking',
      text: t('panel.guests.card.booking', { id: origin.booking_id }),
      muted: false,
    });
  }
  if (origin.conversation_id !== undefined && origin.conversation_id !== null) {
    lines.push({
      key: 'conversation',
      text: t('panel.guests.card.conversation', { id: origin.conversation_id }),
      muted: false,
    });
  }
  return lines;
}

/**
 * True when the office has a number to look the guest up by in Hostaway but no link: the address
 * of a conversation in Hostaway's inbox is not confirmed (docs/guest-signals.md §10.1), so no
 * button is made up — the page says to search by the number.
 */
export function needsPmsSearch(origin: GuestOrigin): boolean {
  return (
    (origin.booking_id !== undefined && origin.booking_id !== null) ||
    (origin.conversation_id !== undefined && origin.conversation_id !== null)
  );
}
