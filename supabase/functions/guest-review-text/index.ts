/**
 * guest-review-text, wired to Supabase and Hostaway. The rules are in
 * handler.ts and in take_review_text_read; this file is the plumbing.
 *
 * verify_jwt is off (supabase/config.toml), for the reason manage-staff gives:
 * a browser preflight carries no Authorization header. The token is checked
 * here, against Auth and profiles, before anything is read.
 *
 * Only GET requests reach Hostaway (and the token request every client of it
 * makes). One client lives as long as the function's instance, so its token
 * serves every read the instance answers instead of one token a read.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

import { readConfig } from "../_shared/env.ts";
import { HostawayClient } from "../_shared/hostaway.ts";
import { createSignalKeyer, readSignalKeySecret } from "../_shared/signals/key.ts";
import { createReviewTextHandler, READABLE_PROVIDER, type ReviewTextDeps } from "./handler.ts";
import { listHostawayReviews } from "./pms.ts";

async function buildDeps(): Promise<ReviewTextDeps> {
  const config = readConfig(Deno.env);
  const admin = createClient(config.supabaseUrl, config.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const hostaway = new HostawayClient(config.hostaway);
  const keyOf = await createSignalKeyer(READABLE_PROVIDER, "review", readSignalKeySecret(Deno.env));

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
      if (profile.error !== null || profile.data === null) {
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
      const { data, error } = await admin.rpc("take_review_text_read", { p_user_id: userId });
      if (error !== null || typeof data !== "boolean") {
        throw new Error("The read counter did not answer");
      }
      return data;
    },
    findReview: async (hostId, signalId) => {
      const { data, error } = await admin
        .from("guest_signals")
        .select("provider, external_key, submitted_at, stay_exact")
        .eq("id", signalId)
        .eq("host_id", hostId)
        .eq("kind", "review")
        .maybeSingle();
      if (error !== null) {
        throw new Error("The review could not be looked up");
      }
      return data === null ? null : {
        provider: data.provider,
        externalKey: data.external_key,
        submittedAt: data.submitted_at,
        stayExact: data.stay_exact,
      };
    },
    listReviews: (window) => listHostawayReviews(hostaway, window),
    keyOf,
  };
}

const deps = await buildDeps();
Deno.serve(createReviewTextHandler(deps));
