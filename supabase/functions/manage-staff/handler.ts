/**
 * Staff accounts — the only door the panel has to auth.users.
 *
 * Why a function and not an RPC. A person's role has to land in two places at
 * once: `app_metadata.role`, which the panel guard reads out of the token, and
 * `profiles.role`, which row security reads. Only the Admin API can write the
 * first, and a path that wrote one without the other would guarantee they
 * drift apart. Passwords are the same story — there is no way to set one from
 * SQL, and no reason to want one.
 *
 * What this file owns: who is allowed to ask, what a valid request looks like,
 * and what the refusal is called. What it does not own: Supabase itself. Every
 * call out is a dependency, so the rules below are testable without a network,
 * a database or a mailbox — the same split the Hostaway webhook uses.
 *
 * Refusals follow the house convention: an English `message` for the log, a
 * stable i18n key in `hint`, and its parameters as JSON in `details`. The panel
 * translates them with `serverErrorText()`, the same function it uses for
 * refusals raised by the database.
 */

export const STAFF_ROLES = ["cleaner", "tech", "manager", "admin"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const LANGUAGES = ["en", "ru", "cs"] as const;
export type Language = (typeof LANGUAGES)[number];

/** The roles that may open this door at all. */
const PANEL_ROLES: readonly string[] = ["manager", "admin"];

const MAX_NAME = 80;
const MAX_PHONE = 32;

/** Light shape check only. Auth is the authority on what an address is. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
} as const;

/** Who is asking, as the database knows them — not as the token claims. */
export interface Caller {
  readonly id: string;
  readonly role: string;
  readonly hostId: string;
  readonly isActive: boolean;
}

/** Somebody already on the team. */
export interface StaffMember {
  readonly id: string;
  readonly email: string;
  readonly fullName: string | null;
  readonly hostId: string;
  readonly role: string;
}

/** The part of a person the manager fills in. */
export interface StaffProfile {
  readonly fullName: string;
  readonly phone: string | null;
  readonly role: StaffRole;
  readonly language: Language | null;
  readonly isActive: boolean;
}

/**
 * Whether the letter went.
 *
 * A password that could not be posted is still a working password: the manager
 * has it on screen and can read it out. The refusal is reported, never thrown —
 * losing the account because the mailbox was busy would be the worse outcome.
 */
export interface MailOutcome {
  readonly sent: boolean;
  /** An i18n key saying why not, for the panel to translate. Null when it went. */
  readonly failureKey: string | null;
}

export interface CreatedStaff extends MailOutcome {
  readonly id: string;
}

export interface StaffDeps {
  /** The person behind the token, or null when there is nobody. */
  readonly identify: (accessToken: string) => Promise<Caller | null>;
  readonly findStaff: (id: string) => Promise<StaffMember | null>;
  readonly createStaff: (input: {
    email: string;
    password: string;
    hostId: string;
    profile: StaffProfile;
  }) => Promise<CreatedStaff>;
  readonly updateStaff: (input: { id: string; profile: StaffProfile }) => Promise<void>;
  readonly setPassword: (input: {
    id: string;
    email: string;
    fullName: string | null;
    password: string;
  }) => Promise<MailOutcome>;
  readonly makePassword: (fullName: string | null, email: string) => string;
}

/**
 * A refusal with everything the panel needs to say it in the reader's language.
 *
 * Exported because the wiring throws these too: "that address already has an
 * account" is a refusal a person should read, and only the Supabase call knows
 * it happened.
 */
export class StaffRefusal extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly hint: string,
    readonly params: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = "StaffRefusal";
  }
}

function refuse(
  status: number,
  message: string,
  hint: string,
  params: Record<string, unknown> | null = null,
): never {
  throw new StaffRefusal(status, message, hint, params);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A trimmed string, or null for "nothing was said". */
function text(source: Record<string, unknown>, field: string): string | null {
  const value = source[field];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization");
  if (header === null) {
    return null;
  }
  const [scheme, token] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && (token ?? "").trim() !== ""
    ? (token as string).trim()
    : null;
}

// ---------------------------------------------------------------------------
//  Reading a request
// ---------------------------------------------------------------------------

function readProfile(payload: Record<string, unknown>, isCreate: boolean): StaffProfile {
  const staff = isRecord(payload.staff) ? payload.staff : {};

  const fullName = text(staff, "fullName");
  if (fullName === null) {
    refuse(400, "A person needs a name", "serverErrors.staffNameRequired");
  }
  if (fullName.length > MAX_NAME) {
    refuse(400, `The name is longer than ${MAX_NAME} characters`, "serverErrors.staffNameTooLong", {
      limit: MAX_NAME,
    });
  }

  const phone = text(staff, "phone");
  if (phone !== null && phone.length > MAX_PHONE) {
    refuse(
      400,
      `The phone number is longer than ${MAX_PHONE} characters`,
      "serverErrors.staffPhoneTooLong",
      { limit: MAX_PHONE },
    );
  }

  const role = text(staff, "role");
  if (role === null || !(STAFF_ROLES as readonly string[]).includes(role)) {
    refuse(400, `Unknown role ${JSON.stringify(role)}`, "serverErrors.staffRoleInvalid");
  }

  const language = text(staff, "language");
  if (language !== null && !(LANGUAGES as readonly string[]).includes(language)) {
    refuse(400, `Unknown language ${JSON.stringify(language)}`, "serverErrors.staffLanguageInvalid");
  }

  // A new account is active by definition; there is no "create somebody
  // switched off". An edit says so explicitly, and a missing flag is a bug in
  // the caller rather than a reason to switch anyone off.
  const active = staff.isActive;
  if (!isCreate && typeof active !== "boolean") {
    refuse(400, "isActive must be sent as a boolean", "serverErrors.staffPayloadInvalid");
  }

  return {
    fullName,
    phone,
    role: role as StaffRole,
    language: language as Language | null,
    isActive: isCreate ? true : (active as boolean),
  };
}

function readEmail(payload: Record<string, unknown>): string {
  const staff = isRecord(payload.staff) ? payload.staff : {};
  const email = text(staff, "email")?.toLowerCase() ?? null;
  if (email === null || !EMAIL_SHAPE.test(email)) {
    refuse(400, `Not an email address: ${JSON.stringify(email)}`, "serverErrors.staffEmailInvalid");
  }
  return email;
}

function readId(payload: Record<string, unknown>): string {
  const id = text(payload, "id");
  if (id === null) {
    refuse(400, "No person was named", "serverErrors.staffPayloadInvalid");
  }
  return id;
}

// ---------------------------------------------------------------------------
//  Who may do what
// ---------------------------------------------------------------------------

/**
 * Only an admin mints an admin.
 *
 * A manager who could promote somebody to admin could promote herself through
 * a second account, which makes the distinction between the two roles a
 * formality.
 */
function guardAdminRole(caller: Caller, role: StaffRole): void {
  if (role === "admin" && caller.role !== "admin") {
    refuse(403, "Only an admin may grant the admin role", "serverErrors.adminRoleForbidden");
  }
}

/**
 * The person being changed, once it is established they are ours to change.
 *
 * Another company's account answers "no such person" rather than "not yours":
 * a manager has no business learning that an address exists elsewhere.
 */
async function loadTarget(deps: StaffDeps, caller: Caller, id: string): Promise<StaffMember> {
  const target = await deps.findStaff(id);
  if (target === null || target.hostId !== caller.hostId) {
    refuse(404, `No such person in this company: ${id}`, "serverErrors.staffNotFound");
  }
  if (target.role === "admin" && caller.role !== "admin") {
    refuse(403, "Only an admin may change an admin", "serverErrors.adminRoleForbidden");
  }
  return target;
}

/**
 * Nobody edits their own role or switches themselves off.
 *
 * Not a security boundary — a manager can do either through a colleague. It is
 * a guard against the one mistake that cannot be undone from inside the panel:
 * the last manager locking herself out of it.
 */
function guardSelf(caller: Caller, target: StaffMember, profile: StaffProfile): void {
  if (target.id !== caller.id) {
    return;
  }
  if (profile.role !== target.role || !profile.isActive) {
    refuse(
      403,
      "A manager cannot change their own role or switch themselves off",
      "serverErrors.staffSelfChange",
    );
  }
}

// ---------------------------------------------------------------------------
//  The actions
// ---------------------------------------------------------------------------

async function create(
  deps: StaffDeps,
  caller: Caller,
  payload: Record<string, unknown>,
): Promise<Response> {
  const email = readEmail(payload);
  const profile = readProfile(payload, true);
  guardAdminRole(caller, profile.role);

  const password = deps.makePassword(profile.fullName, email);
  const created = await deps.createStaff({ email, password, hostId: caller.hostId, profile });

  return json(
    {
      success: true,
      data: {
        id: created.id,
        password,
        emailSent: created.sent,
        mailFailureKey: created.failureKey,
      },
    },
    200,
  );
}

async function update(
  deps: StaffDeps,
  caller: Caller,
  payload: Record<string, unknown>,
): Promise<Response> {
  const id = readId(payload);
  const profile = readProfile(payload, false);
  guardAdminRole(caller, profile.role);

  const target = await loadTarget(deps, caller, id);
  guardSelf(caller, target, profile);

  await deps.updateStaff({ id: target.id, profile });
  return json({ success: true, data: { id: target.id } }, 200);
}

/**
 * A new password, shown to the manager and posted to the person.
 *
 * The same operation serves both buttons in the panel. "Reset the password"
 * and "send a new one, the letter never arrived" differ only in why the
 * manager pressed: an existing password cannot be shown — it is stored hashed —
 * so the only thing either button can do is make a new one.
 */
async function resetPassword(
  deps: StaffDeps,
  caller: Caller,
  payload: Record<string, unknown>,
): Promise<Response> {
  const target = await loadTarget(deps, caller, readId(payload));
  const password = deps.makePassword(target.fullName, target.email);

  const outcome = await deps.setPassword({
    id: target.id,
    email: target.email,
    fullName: target.fullName,
    password,
  });

  return json(
    {
      success: true,
      data: {
        id: target.id,
        password,
        emailSent: outcome.sent,
        mailFailureKey: outcome.failureKey,
      },
    },
    200,
  );
}

// ---------------------------------------------------------------------------
//  The door
// ---------------------------------------------------------------------------

async function authorize(deps: StaffDeps, request: Request): Promise<Caller> {
  const token = bearerToken(request);
  if (token === null) {
    refuse(401, "No bearer token", "serverErrors.notSignedIn");
  }

  const caller = await deps.identify(token);
  if (caller === null) {
    refuse(401, "The token belongs to nobody", "serverErrors.notSignedIn");
  }
  if (!caller.isActive || !PANEL_ROLES.includes(caller.role)) {
    refuse(403, `Role ${caller.role} may not manage staff`, "serverErrors.managerOnly");
  }
  return caller;
}

export function createStaffHandler(deps: StaffDeps): (request: Request) => Promise<Response> {
  return async function handleStaffRequest(request: Request): Promise<Response> {
    // The panel calls this from a browser, so the preflight has to be answered
    // before anything asks for a token — a preflight carries none.
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== "POST") {
      return json(
        { success: false, error: { message: "Only POST", hint: "serverErrors.unknown" } },
        405,
      );
    }

    try {
      const caller = await authorize(deps, request);

      const body: unknown = await request.json().catch(() => null);
      if (!isRecord(body)) {
        refuse(400, "The body is not an object", "serverErrors.staffPayloadInvalid");
      }

      switch (text(body, "action")) {
        case "create":
          return await create(deps, caller, body);
        case "update":
          return await update(deps, caller, body);
        case "reset_password":
          return await resetPassword(deps, caller, body);
        default:
          return refuse(
            400,
            `Unknown action ${JSON.stringify(body.action)}`,
            "serverErrors.staffPayloadInvalid",
          );
      }
    } catch (error: unknown) {
      if (error instanceof StaffRefusal) {
        return json(
          {
            success: false,
            error: {
              message: error.message,
              hint: error.hint,
              details: error.params === null ? undefined : JSON.stringify(error.params),
            },
          },
          error.status,
        );
      }

      const message = error instanceof Error ? error.message : String(error);
      console.error(`manage-staff failed: ${message}`);
      return json({ success: false, error: { message, hint: "serverErrors.unknown" } }, 500);
    }
  };
}
