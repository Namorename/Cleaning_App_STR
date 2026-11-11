/**
 * The one question guest-message-text asks Hostaway: a conversation's messages, every page — a GET,
 * paged as read-guest-messages pages it. The answer stays in handler.ts's memory, which keeps only
 * the guest's own messages around the one asked for.
 */

import { type HostawayClient, HostawayError } from "../_shared/hostaway.ts";
import { CONVERSATIONS_ENDPOINT, MESSAGES_PAGE_SIZE } from "../_shared/signals/hostaway.ts";

/** A Hostaway id as it may go into a path: digits, no sign, no zero in front. */
const HOSTAWAY_ID = /^[1-9]\d{0,17}$/;
/** How the shared client words a 404 (`_shared/hostaway.ts`); only its status is read. */
const NOT_FOUND = /^Hostaway returned HTTP 404\b/;

/** Hostaway has no such conversation (any more): not a failure of Hostaway, nothing to try again. */
export class ConversationGoneError extends Error {
  override readonly name = "ConversationGoneError";
}

export async function listConversationMessages(
  client: Pick<HostawayClient, "listAll">,
  conversationId: string,
): Promise<unknown[]> {
  if (!HOSTAWAY_ID.test(conversationId)) {
    throw new ConversationGoneError("Not a Hostaway conversation id");
  }
  try {
    return await client.listAll(`${CONVERSATIONS_ENDPOINT}/${conversationId}/messages`, MESSAGES_PAGE_SIZE);
  } catch (error: unknown) {
    if (error instanceof HostawayError && NOT_FOUND.test(error.message)) {
      throw new ConversationGoneError("Hostaway has no such conversation");
    }
    throw error;
  }
}
