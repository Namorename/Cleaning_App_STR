/**
 * guest-message-text, wired to Supabase and Hostaway. The rules are in handler.ts and in
 * guest_message_target / take_message_text_read (20261111140000); this file is the plumbing.
 *
 * verify_jwt is off (supabase/config.toml), for the reason manage-staff gives: a browser preflight
 * carries no Authorization header. The token is checked here, against Auth and profiles, before
 * anything is read.
 *
 * Only GET requests reach Hostaway (and the token request every client of it makes). One client lives
 * as long as the function's instance, so its token serves every read the instance answers.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

import { readConfig } from "../_shared/env.ts";
import { HostawayClient } from "../_shared/hostaway.ts";
import { createSignalKeyer, readSignalKeySecret } from "../_shared/signals/key.ts";
import { MessageAnswerCache } from "./cache.ts";
import { createMessageTextHandler, type MessageTextDeps, READABLE_PROVIDER, readTarget } from "./handler.ts";
import { listConversationMessages } from "./pms.ts";

async function buildDeps(): Promise<MessageTextDeps> {
  const config = readConfig(Deno.env);
  const admin = createClient(config.supabaseUrl, config.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const hostaway = new HostawayClient(config.hostaway);
  const keyOf = await createSignalKeyer(READABLE_PROVIDER, "message", readSignalKeySecret(Deno.env));

  return {
    identify: async (token) => {
      const { data, error } = await admin.auth.getUser(token);
      if (error !== null || data.user === null) {
        return null;
      }
      const profile = await admin
        .from("profiles")
        .select("id, role, host_id, is_active")
        .eq("id", data.user.id)
        .maybeSingle();
      if (profile.error !== null || profile.data === null || profile.data.host_id === null) {
        return null;
      }
      return {
        id: profile.data.id,
        role: profile.data.role,
        hostId: profile.data.host_id,
        isActive: profile.data.is_active,
      };
    },
    takeRead: async (userId) => {
      const { data, error } = await admin.rpc("take_message_text_read", { p_user_id: userId });
      if (error !== null || typeof data !== "boolean") {
        throw new Error("The read counter did not answer");
      }
      return data;
    },
    findTarget: async (userId, ask) => {
      const { data, error } = await admin.rpc("guest_message_target", {
        p_user_id: userId,
        p_problem_id: "problemId" in ask ? ask.problemId : null,
        p_finding_id: "findingId" in ask ? ask.findingId : null,
      });
      if (error !== null) {
        throw new Error("The message could not be looked up");
      }
      return readTarget(data);
    },
    listMessages: (conversationId) => listConversationMessages(hostaway, conversationId),
    keyOf,
    // One per instance, in memory only: an answer for three minutes (cache.ts).
    answers: new MessageAnswerCache(),
  };
}

const deps = await buildDeps();
Deno.serve(createMessageTextHandler(deps));
