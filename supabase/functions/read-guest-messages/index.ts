/**
 * read-guest-messages (docs/guest-chats.md): one tick of reading guests' chats,
 * every two minutes outside 03:00–04:40 UTC by pg_cron (both jobs are created
 * inactive; the word «включай чаты» turns them on with the switch). Nothing
 * happens while signal_settings.messages_enabled is off: the first question is
 * the switch, before Hostaway or the model is touched.
 *
 * Only GET requests reach Hostaway. The texts are read in memory and leave as
 * labels: this function stores no text. GUEST_SIGNAL_KEY_SECRET is read as
 * sync-guest-signals reads it, to key messages and conversations;
 * ANTHROPIC_API_KEY is the model's, and without it conversations wait.
 */

import { readConfig } from "../_shared/env.ts";
import { defaultHostId } from "../_shared/signals/db.ts";
import { HostawayAdapter } from "../_shared/signals/hostaway.ts";
import { serveJob } from "../_shared/signals/http.ts";
import { createConversationKeyer, createSignalKeyer, readSignalKeySecret } from "../_shared/signals/key.ts";
import { createMessageStore } from "../_shared/signals/message-db.ts";
import { AnthropicMessageThemeClient } from "../_shared/signals/message-read.ts";
import { runMessages } from "../_shared/signals/message-run.ts";

serveJob("read-guest-messages", async (client) => {
  const hostId = await defaultHostId(client);
  const store = createMessageStore(client, hostId, "hostaway");
  const state = await store.state();
  if (state === null || !state.enabled) {
    return { status: "off" };
  }

  const config = readConfig(Deno.env);
  const adapter = new HostawayAdapter(config.hostaway);
  const secret = readSignalKeySecret(Deno.env);
  const key = Deno.env.get("ANTHROPIC_API_KEY")?.trim() ?? "";
  return await runMessages({
    store,
    adapter,
    model: key === "" ? null : new AnthropicMessageThemeClient(key),
    keyOf: await createSignalKeyer(adapter.provider, "message", secret),
    conversationKeyOf: await createConversationKeyer(adapter.provider, secret),
  });
});
