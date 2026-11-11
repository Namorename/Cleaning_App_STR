/**
 * The guest's message of a chat task, as guest-message-text answers (20261111140000, the owner's word
 * of 2026-11-11): the message a card was raised on and at most two of the guest's messages around it,
 * read from Hostaway when a manager or the head technician presses the button. The panel and the
 * phone hold it in memory only, for as long as the screen is open; nothing of it is stored anywhere.
 */
import { INTL_LOCALES, isSupportedLanguage } from '../i18n';

/** The function that reads it (supabase/functions/guest-message-text). */
export const GUEST_MESSAGE_FUNCTION = 'guest-message-text';

/** The company's clock: the time a message was sent is said in it, as the rest of the product does. */
const COMPANY_TIME_ZONE = 'Europe/Prague';

export interface GuestMessage {
  /** When it was sent, UTC (ISO). */
  readonly sent_at: string;
  /** The guest's words as Hostaway has them; null for a message of files alone. */
  readonly text: string | null;
  /** How many files came with it. */
  readonly attachments: number;
  /** The message the card was raised on; the others are its context. */
  readonly is_flagged: boolean;
}

/** What the screen asks about: a task (the task's page, the phone) or a card of «Гости». */
export type GuestMessageAsk = { readonly problemId: string } | { readonly findingId: string };

/** The function's body for an ask. */
export function guestMessageBody(ask: GuestMessageAsk): Record<string, string> {
  return 'problemId' in ask ? { problem_id: ask.problemId } : { finding_id: ask.findingId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readOne(value: unknown): GuestMessage | null {
  if (!isRecord(value) || typeof value.sent_at !== 'string' || Number.isNaN(Date.parse(value.sent_at))) {
    return null;
  }
  return {
    sent_at: value.sent_at,
    text: typeof value.text === 'string' && value.text.trim() !== '' ? value.text : null,
    attachments:
      typeof value.attachments === 'number' && Number.isInteger(value.attachments) && value.attachments > 0
        ? value.attachments
        : 0,
    is_flagged: value.is_flagged === true,
  };
}

/**
 * The function's `data` read field by field: a message it cannot read is left out. Null when the
 * answer is not the function's at all, or holds no message.
 */
export function readGuestMessages(value: unknown): readonly GuestMessage[] | null {
  if (!isRecord(value) || !Array.isArray(value.messages)) {
    return null;
  }
  const messages = value.messages
    .map(readOne)
    .filter((message): message is GuestMessage => message !== null);
  return messages.length === 0 ? null : messages;
}

/** Why the message is not on screen, each with its own words (problems.guestMessage.*). */
export const GUEST_MESSAGE_FAILURES = [
  'expired',
  'unavailable',
  'forbidden',
  'limited',
  'notFound',
  'failed',
] as const;
export type GuestMessageFailure = (typeof GUEST_MESSAGE_FAILURES)[number];

const FAILURE_BY_HINT: Readonly<Record<string, GuestMessageFailure>> = {
  'serverErrors.guestMessageGone': 'expired',
  'serverErrors.guestMessageUnavailable': 'unavailable',
  'serverErrors.guestMessageForbidden': 'forbidden',
  'serverErrors.guestMessageLimit': 'limited',
  'serverErrors.guestMessageNotFound': 'notFound',
};

/** The failure a refusal's i18n key names; anything else — the network, a session gone — is «failed». */
export function guestMessageFailure(hint: string | null | undefined): GuestMessageFailure {
  return (hint !== null && hint !== undefined ? FAILURE_BY_HINT[hint] : undefined) ?? 'failed';
}

/** Whether pressing again may help: Hostaway or the limit may answer later; an expired message never. */
export function canRetryGuestMessage(failure: GuestMessageFailure): boolean {
  return failure === 'unavailable' || failure === 'limited' || failure === 'failed';
}

/** «10 нояб. 2026 г., 15:00» — the day and the time it was sent, on the company's clock. */
export function formatGuestMessageTime(sentAt: string, language: string): string {
  const at = new Date(sentAt);
  if (Number.isNaN(at.getTime())) {
    return sentAt;
  }
  const locale = isSupportedLanguage(language) ? INTL_LOCALES[language] : INTL_LOCALES.en;
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: COMPANY_TIME_ZONE,
  }).format(at);
}
