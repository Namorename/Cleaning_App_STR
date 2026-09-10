/**
 * Staff accounts, wired to Supabase.
 *
 * The rules live in handler.ts; this file is only the plumbing — the Admin
 * API, the profiles table, and the one call that posts a letter.
 *
 * ## How the letter is sent
 *
 * Supabase has no "send this email" API. What it has is the auth mailer: the
 * templates it sends on invite, confirmation and password recovery, each of
 * which can read `{{ .Data }}` — the person's own user_metadata. So the
 * password is put there, `resetPasswordForEmail` is asked to post the Recovery
 * template, and the value is cleared again the moment the call returns. It is
 * in the clear for the length of one HTTP call and no longer, which is the
 * price of not adding a second mail provider to the system.
 *
 * The same path serves a new account and a reset. One template, worded for
 * both, is easier to keep true than two that drift.
 *
 * Delivery needs custom SMTP configured in the project's auth settings. The
 * built-in sender refuses any address that is not a project member's and caps
 * out at a couple of messages an hour — see README. When the letter does not
 * go, the account and the password are still made and the manager is told, so
 * she can read the password out instead.
 *
 * ## verify_jwt is off, on purpose
 *
 * Not because the function is open — it verifies the token itself, and then
 * asks the database what that person's role and company actually are. It is
 * off because a browser preflight carries no Authorization header, and the
 * gateway would turn it into a 401 the panel could not explain.
 */

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

import { readPublishableKey, readSupabaseCredentials } from "../_shared/env.ts";
import { generatePassword } from "../_shared/staff-password.ts";
import {
  type Caller,
  type CreatedStaff,
  createStaffHandler,
  type MailOutcome,
  type StaffMember,
  type StaffProfile,
  StaffRefusal,
} from "./handler.ts";

/** Where the password waits while auth renders the letter. Never longer. */
const STAGED_PASSWORD = "initial_password";

const PROFILE_COLUMNS = "id, role, host_id, is_active, full_name, email";

interface ProfileRow {
  id: string;
  role: string;
  host_id: string;
  is_active: boolean;
  full_name: string | null;
  email: string | null;
}

/**
 * Both clients are built once per cold start.
 *
 * A missing secret is a deployment mistake, not a request the caller made
 * wrong: the client stays null and every request answers 500 with the reason
 * in the log, rather than the whole module failing to import and leaving an
 * error nobody can read.
 */
const clients = (() => {
  try {
    const { supabaseUrl, supabaseSecretKey } = readSupabaseCredentials(Deno.env);
    const publishableKey = readPublishableKey(Deno.env);
    return {
      admin: createClient(supabaseUrl, supabaseSecretKey, { auth: { persistSession: false } }),
      // The mailer is asked as an ordinary caller would ask, not as the
      // service role: this is the same endpoint a "forgot my password" link
      // reaches.
      postbox: publishableKey === null
        ? null
        : createClient(supabaseUrl, publishableKey, { auth: { persistSession: false } }),
    };
  } catch (error: unknown) {
    console.error(
      `manage-staff has no Supabase client: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return { admin: null, postbox: null };
  }
})();

function admin(): SupabaseClient {
  if (clients.admin === null) {
    throw new Error("Supabase client is unavailable: check the environment variables");
  }
  return clients.admin;
}

// ---------------------------------------------------------------------------
//  Reading people
// ---------------------------------------------------------------------------

async function loadProfile(id: string): Promise<ProfileRow | null> {
  const { data, error } = await admin()
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`profiles select: ${error.message}`);
  }
  return (data as ProfileRow | null) ?? null;
}

async function identify(accessToken: string): Promise<Caller | null> {
  const { data, error } = await admin().auth.getUser(accessToken);
  if (error !== null || data.user === null) {
    return null;
  }

  const profile = await loadProfile(data.user.id);
  if (profile === null) {
    return null;
  }

  return {
    id: profile.id,
    role: profile.role,
    hostId: profile.host_id,
    isActive: profile.is_active,
  };
}

async function findStaff(id: string): Promise<StaffMember | null> {
  const profile = await loadProfile(id);
  if (profile === null) {
    return null;
  }

  // Auth allows an account with a phone and no address; this product has no
  // way to make one, and no way to post a password to one either. Saying so is
  // better than a letter that silently goes nowhere.
  if (profile.email === null) {
    throw new StaffRefusal(
      409,
      `Account ${id} has no email address to write to`,
      "serverErrors.staffNoEmail",
    );
  }

  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    hostId: profile.host_id,
    role: profile.role,
  };
}

// ---------------------------------------------------------------------------
//  Writing them
// ---------------------------------------------------------------------------

/** `identity` is sent on creation only — a company and a login are not edits. */
async function writeProfile(
  id: string,
  profile: StaffProfile,
  identity?: { hostId: string; email: string },
): Promise<void> {
  const row = {
    id,
    full_name: profile.fullName,
    phone: profile.phone,
    preferred_language: profile.language,
    role: profile.role,
    is_active: profile.isActive,
    ...(identity === undefined ? {} : { host_id: identity.hostId, email: identity.email }),
  };

  const { error } = await admin().from("profiles").upsert(row, { onConflict: "id" });
  if (error !== null) {
    throw new Error(`profiles upsert: ${error.message}`);
  }
}

/** An address that already has an account is a refusal a person should read. */
function asRefusal(error: { message: string; status?: number; code?: string }): Error {
  const taken = error.code === "email_exists" ||
    /already (been )?registered|already exists/i.test(error.message);

  return taken
    ? new StaffRefusal(409, error.message, "serverErrors.staffEmailTaken")
    : new Error(`createUser: ${error.message}`);
}

async function createStaff(input: {
  email: string;
  password: string;
  hostId: string;
  profile: StaffProfile;
}): Promise<CreatedStaff> {
  const { data, error } = await admin().auth.admin.createUser({
    email: input.email,
    password: input.password,
    // The manager vouched for the address by typing it. Making the cleaner
    // click a confirmation link before her first shift would only mean she
    // cannot sign in on the morning she was hired.
    email_confirm: true,
    app_metadata: { role: input.profile.role },
    user_metadata: { full_name: input.profile.fullName },
  });

  if (error !== null) {
    throw asRefusal(error);
  }

  await writeProfile(data.user.id, input.profile, { hostId: input.hostId, email: input.email });

  const outcome = await postPassword(
    data.user.id,
    input.email,
    input.profile.fullName,
    input.password,
  );
  return { id: data.user.id, ...outcome };
}

/**
 * The profile row is written before app_metadata.
 *
 * Row security is what actually guards the data, and `is_active` — the switch
 * that closes access — lives only in the row. If the second write fails, the
 * half-done change is the one the manager asked for rather than its opposite:
 * somebody switched off in the panel is switched off in the database, whatever
 * their token still says.
 */
async function updateStaff(input: { id: string; profile: StaffProfile }): Promise<void> {
  await writeProfile(input.id, input.profile);

  const { error } = await admin().auth.admin.updateUserById(input.id, {
    app_metadata: { role: input.profile.role },
    user_metadata: { full_name: input.profile.fullName },
  });
  if (error !== null) {
    throw new Error(`updateUserById: ${error.message}`);
  }
}

async function setPassword(input: {
  id: string;
  email: string;
  fullName: string | null;
  password: string;
}): Promise<MailOutcome> {
  const { error } = await admin().auth.admin.updateUserById(input.id, { password: input.password });
  if (error !== null) {
    throw new Error(`updateUserById(password): ${error.message}`);
  }

  return postPassword(input.id, input.email, input.fullName, input.password);
}

/**
 * Ask auth to post the password, then take it back out of the metadata.
 *
 * The clearing is in `finally` for a reason: a password left in user_metadata
 * is stored in the clear, is readable by the person it belongs to, and would
 * still be sitting there long after the letter it was staged for failed to go.
 */
async function postPassword(
  id: string,
  email: string,
  fullName: string | null,
  password: string,
): Promise<MailOutcome> {
  if (clients.postbox === null) {
    console.error("No publishable key: the password was not posted");
    return { sent: false, failureKey: "serverErrors.mailNotConfigured" };
  }

  try {
    const staged = await admin().auth.admin.updateUserById(id, {
      user_metadata: { full_name: fullName, [STAGED_PASSWORD]: password },
    });
    if (staged.error !== null) {
      console.error(`Could not stage the password for ${id}: ${staged.error.message}`);
      return { sent: false, failureKey: "serverErrors.mailNotSent" };
    }

    const { error } = await clients.postbox.auth.resetPasswordForEmail(email);
    if (error !== null) {
      console.error(`Auth refused to write to ${email}: ${error.message}`);
      return {
        sent: false,
        // Auth will not write to the same address twice in quick succession.
        // That is a "try again in a minute", not a broken mailbox.
        failureKey: error.status === 429 ? "serverErrors.mailTooSoon" : "serverErrors.mailNotSent",
      };
    }

    return { sent: true, failureKey: null };
  } finally {
    const cleared = await admin().auth.admin.updateUserById(id, {
      user_metadata: { full_name: fullName, [STAGED_PASSWORD]: null },
    });
    if (cleared.error !== null) {
      console.error(`Staged password for ${id} was not cleared: ${cleared.error.message}`);
    }
  }
}

Deno.serve(
  createStaffHandler({
    identify,
    findStaff,
    createStaff,
    updateStaff,
    setPassword,
    makePassword: (fullName, email) => generatePassword(fullName, email),
  }),
);
