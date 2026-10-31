/**
 * What the webhook journal keeps of a guest message (owner's decisions of 2026-10-31,
 * docs/guest-signals.md §10, decisions 3 and 4; docs/guest-signals-intake.md).
 *
 * A message notification is stored with the fields that route and time it, and nothing
 * else: no text, no attachments, no guest name, e-mail or phone. When a message is analysed
 * later it is read again from Hostaway (docs/guest-signals.md §5), so the journal never needs
 * the text. Every other notification — reservations above all — is stored exactly as it came.
 *
 * The two key lists are written out again in docs/one-off-writes/guest-message-bodies-wipe.sql
 * and docs/rollout/guest_message_intake_probe.sql; guest-message.test.ts keeps all three equal.
 */

/** Top-level keys of a kept message notification: what it is and which account sent it. */
export const MESSAGE_TOP_LEVEL_KEYS = ["object", "event", "objectId", "accountId"] as const;

/**
 * Keys kept from `data`: the message id (the journal's object id comes from it), the
 * direction, the channel, the conversation, reservation and listing ids, and the times.
 */
export const MESSAGE_DATA_KEYS = [
  "id",
  "conversationId",
  "reservationId",
  "listingMapId",
  "isIncoming",
  "communicationType",
  "channelId",
  "date",
  "insertedOn",
  "updatedOn",
  "sentChannelDate",
  "listingTimeZoneName",
] as const;

/**
 * Words that mark a notification about a conversation message, in its `object` or `event`.
 * The SQL files repeat them as `object_type ~* 'message'` and `event_type ~* '^(message|conversation)'`.
 */
export const MESSAGE_OBJECT = /message/i;
export const MESSAGE_EVENT = /^(message|conversation)/i;

/** The same words, looked for in a body that did not parse as JSON. */
export const MESSAGE_IN_RAW_TEXT = /conversationMessage|message\.received/i;

type JsonScalar = string | number | boolean | null;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): value is JsonScalar {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

/** The listed keys of an object whose values are scalars; a nested value is never kept. */
function pickScalars(source: Record<string, unknown>, keys: readonly string[]): Record<string, JsonScalar> {
  const kept: Record<string, JsonScalar> = {};
  for (const key of keys) {
    const value = source[key];
    if (Object.hasOwn(source, key) && isScalar(value)) {
      kept[key] = value;
    }
  }
  return kept;
}

/** Whether a parsed notification is about a conversation message (Hostaway: conversationMessage, message.received). */
export function isGuestMessageEvent(payload: unknown): boolean {
  if (!isPlainObject(payload)) {
    return false;
  }
  const { object, event } = payload;
  return (
    (typeof object === "string" && MESSAGE_OBJECT.test(object)) ||
    (typeof event === "string" && MESSAGE_EVENT.test(event))
  );
}

/** A message notification cut down to the listed fields. */
export function minimizeGuestMessage(payload: Record<string, unknown>): Record<string, unknown> {
  const kept: Record<string, unknown> = pickScalars(payload, MESSAGE_TOP_LEVEL_KEYS);
  if (isPlainObject(payload.data)) {
    kept.data = pickScalars(payload.data, MESSAGE_DATA_KEYS);
  }
  return kept;
}

/** What goes into the journal for a parsed body: a message cut down, anything else untouched. */
export function journalPayload(payload: unknown): unknown {
  return isPlainObject(payload) && isGuestMessageEvent(payload) ? minimizeGuestMessage(payload) : payload;
}

/**
 * What goes into the journal for a body that did not parse. The raw text is kept so a broken
 * delivery can be looked into by hand — unless it looks like a message, whose text the journal
 * must not hold; then only its length is kept.
 */
export function journalUnparsed(text: string, contentType: string | null): Record<string, unknown> {
  if (MESSAGE_IN_RAW_TEXT.test(text)) {
    return { unparsed: null, unparsedLength: text.length, contentType, withheld: "guest_message" };
  }
  return { unparsed: text, contentType };
}
