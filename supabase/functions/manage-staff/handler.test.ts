import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  type Caller,
  createStaffHandler,
  refusalFromDatabase,
  type SignInBlockWrite,
  type StaffDeps,
  type StaffMember,
  type StaffProfile,
  StaffRefusal,
} from "./handler.ts";

const MANAGER: Caller = { id: "m-1", role: "manager", hostId: "host-1", isActive: true };
const ADMIN: Caller = { id: "a-1", role: "admin", hostId: "host-1", isActive: true };

const MARIA: StaffMember = {
  id: "s-1",
  email: "maria@example.com",
  fullName: "Мария",
  hostId: "host-1",
  role: "cleaner",
  isActive: true,
};

/** Everything succeeds and nothing is recorded, unless a test says otherwise. */
function deps(overrides: Partial<StaffDeps> = {}): StaffDeps {
  return {
    identify: () => Promise.resolve(MANAGER),
    findStaff: (id) => Promise.resolve(id === MARIA.id ? MARIA : null),
    createStaff: () => Promise.resolve({ id: "new-1", sent: true, failureKey: null }),
    updateStaff: () => Promise.resolve(),
    updateAccount: () => Promise.resolve({ appMetadata: {} }),
    setSignInBlock: () => Promise.resolve(),
    setPassword: () => Promise.resolve({ sent: true, failureKey: null }),
    makePassword: () => "Anna-abcde",
    ...overrides,
  };
}

function post(body: unknown, token: string | null = "token"): Request {
  return new Request("https://example.test/manage-staff", {
    method: "POST",
    headers: token === null
      ? { "Content-Type": "application/json" }
      : { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

interface Refusal {
  success: boolean;
  error: { message: string; hint: string; details?: string };
}

async function refusalOf(response: Response): Promise<Refusal> {
  return (await response.json()) as Refusal;
}

const NEW_STAFF = {
  email: "Maria@Example.com",
  fullName: "  Мария Иванова  ",
  phone: "+420 777 111 222",
  role: "cleaner",
  language: "ru",
} as const;

// ---------------------------------------------------------------------------
//  The door
// ---------------------------------------------------------------------------

Deno.test("a preflight is answered without asking for a token", async () => {
  const response = await createStaffHandler(deps())(
    new Request("https://example.test/manage-staff", { method: "OPTIONS" }),
  );
  assertEquals(response.status, 204);
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("anything but POST is refused", async () => {
  const response = await createStaffHandler(deps())(
    new Request("https://example.test/manage-staff", { method: "GET" }),
  );
  assertEquals(response.status, 405);
});

Deno.test("a request with no token is not signed in", async () => {
  const response = await createStaffHandler(deps())(post({ action: "create" }, null));
  assertEquals(response.status, 401);
  assertEquals((await refusalOf(response)).error.hint, "serverErrors.notSignedIn");
});

Deno.test("a token nobody answers to is not signed in either", async () => {
  const handler = createStaffHandler(deps({ identify: () => Promise.resolve(null) }));
  const response = await handler(post({ action: "create" }));
  assertEquals(response.status, 401);
  assertEquals((await refusalOf(response)).error.hint, "serverErrors.notSignedIn");
});

Deno.test("a cleaner may not manage staff", async () => {
  const cleaner: Caller = { id: "c-1", role: "cleaner", hostId: "host-1", isActive: true };
  const handler = createStaffHandler(deps({ identify: () => Promise.resolve(cleaner) }));
  const response = await handler(post({ action: "create", staff: NEW_STAFF }));
  assertEquals(response.status, 403);
  assertEquals((await refusalOf(response)).error.hint, "serverErrors.managerOnly");
});

Deno.test("a manager who has been switched off may not either", async () => {
  const handler = createStaffHandler(
    deps({ identify: () => Promise.resolve({ ...MANAGER, isActive: false }) }),
  );
  const response = await handler(post({ action: "create", staff: NEW_STAFF }));
  assertEquals(response.status, 403);
  assertEquals((await refusalOf(response)).error.hint, "serverErrors.managerOnly");
});

Deno.test("an action nobody implements is refused", async () => {
  const response = await createStaffHandler(deps())(post({ action: "delete", id: "s-1" }));
  assertEquals(response.status, 400);
  assertEquals((await refusalOf(response)).error.hint, "serverErrors.staffPayloadInvalid");
});

Deno.test("a body that is not JSON is refused, not crashed on", async () => {
  const response = await createStaffHandler(deps())(post("not json at all"));
  assertEquals(response.status, 400);
  assertEquals((await refusalOf(response)).error.hint, "serverErrors.staffPayloadInvalid");
});

// ---------------------------------------------------------------------------
//  Creating an account
// ---------------------------------------------------------------------------

Deno.test("creating a person returns the password and posts it", async () => {
  let received: { email: string; password: string; hostId: string; profile: StaffProfile } | null =
    null;
  const handler = createStaffHandler(
    deps({
      createStaff: (input) => {
        received = input;
        return Promise.resolve({ id: "new-1", sent: true, failureKey: null });
      },
    }),
  );

  const response = await handler(post({ action: "create", staff: NEW_STAFF }));

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    success: true,
    data: { id: "new-1", password: "Anna-abcde", emailSent: true, mailFailureKey: null },
  });
  assertEquals(received!.email, "maria@example.com");
  assertEquals(received!.password, "Anna-abcde");
  assertEquals(received!.hostId, "host-1");
  assertEquals(received!.profile, {
    fullName: "Мария Иванова",
    phone: "+420 777 111 222",
    role: "cleaner",
    language: "ru",
    isActive: true,
  });
});

Deno.test("a new account is active — there is no creating somebody switched off", async () => {
  let profile: StaffProfile | null = null;
  const handler = createStaffHandler(
    deps({
      createStaff: (input) => {
        profile = input.profile;
        return Promise.resolve({ id: "new-1", sent: true, failureKey: null });
      },
    }),
  );

  await handler(post({ action: "create", staff: { ...NEW_STAFF, isActive: false } }));
  assertEquals(profile!.isActive, true);
});

Deno.test("the password is still returned when the letter could not go", async () => {
  const handler = createStaffHandler(
    deps({
      createStaff: () =>
        Promise.resolve({ id: "new-1", sent: false, failureKey: "serverErrors.mailNotSent" }),
    }),
  );

  const response = await handler(post({ action: "create", staff: NEW_STAFF }));
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    success: true,
    data: {
      id: "new-1",
      password: "Anna-abcde",
      emailSent: false,
      mailFailureKey: "serverErrors.mailNotSent",
    },
  });
});

Deno.test("an address that is not one is refused", async () => {
  const handler = createStaffHandler(deps());
  for (const email of ["maria", "maria@example", "@example.com", "  "]) {
    const response = await handler(post({ action: "create", staff: { ...NEW_STAFF, email } }));
    assertEquals(response.status, 400);
    assertEquals((await refusalOf(response)).error.hint, "serverErrors.staffEmailInvalid");
  }
});

Deno.test("a person without a name is refused", async () => {
  const response = await createStaffHandler(deps())(
    post({ action: "create", staff: { ...NEW_STAFF, fullName: "   " } }),
  );
  assertEquals(response.status, 400);
  assertEquals((await refusalOf(response)).error.hint, "serverErrors.staffNameRequired");
});

Deno.test("a name past the limit is refused, and the refusal carries the limit", async () => {
  const response = await createStaffHandler(deps())(
    post({ action: "create", staff: { ...NEW_STAFF, fullName: "a".repeat(81) } }),
  );
  assertEquals(response.status, 400);
  const refusal = await refusalOf(response);
  assertEquals(refusal.error.hint, "serverErrors.staffNameTooLong");
  assertEquals(refusal.error.details, '{"limit":80}');
});

Deno.test("a role and a language the app does not have are refused", async () => {
  const handler = createStaffHandler(deps());

  const badRole = await handler(post({ action: "create", staff: { ...NEW_STAFF, role: "boss" } }));
  assertEquals((await refusalOf(badRole)).error.hint, "serverErrors.staffRoleInvalid");

  const badLang = await handler(post({ action: "create", staff: { ...NEW_STAFF, language: "de" } }));
  assertEquals((await refusalOf(badLang)).error.hint, "serverErrors.staffLanguageInvalid");
});

// The owner's decision of 14.10: somebody new reads English until a manager or
// she herself picks another language. A panel that sends no language — the one
// still in production between this deploy and its own — gets English too.
Deno.test("a person created without a language reads English", async () => {
  let profile: StaffProfile | null = null;
  const handler = createStaffHandler(
    deps({
      createStaff: (input) => {
        profile = input.profile;
        return Promise.resolve({ id: "new-1", sent: true, failureKey: null });
      },
    }),
  );

  const response = await handler(
    post({ action: "create", staff: { email: "a@example.com", fullName: "Anna", role: "tech" } }),
  );
  assertEquals(response.status, 200);
  assertEquals(profile!.language, "en");
  assertEquals(profile!.phone, null);
});

Deno.test("a person created with an explicit null language reads English too", async () => {
  let profile: StaffProfile | null = null;
  const handler = createStaffHandler(
    deps({
      createStaff: (input) => {
        profile = input.profile;
        return Promise.resolve({ id: "new-1", sent: true, failureKey: null });
      },
    }),
  );

  const response = await handler(
    post({ action: "create", staff: { ...NEW_STAFF, language: null } }),
  );
  assertEquals(response.status, 200);
  assertEquals(profile!.language, "en");
});

Deno.test("a language the manager picked for somebody new is kept", async () => {
  let profile: StaffProfile | null = null;
  const handler = createStaffHandler(
    deps({
      createStaff: (input) => {
        profile = input.profile;
        return Promise.resolve({ id: "new-1", sent: true, failureKey: null });
      },
    }),
  );

  const response = await handler(post({ action: "create", staff: { ...NEW_STAFF, language: "cs" } }));
  assertEquals(response.status, 200);
  assertEquals(profile!.language, "cs");
});

Deno.test("a manager cannot mint an admin", async () => {
  const response = await createStaffHandler(deps())(
    post({ action: "create", staff: { ...NEW_STAFF, role: "admin" } }),
  );
  assertEquals(response.status, 403);
  assertEquals((await refusalOf(response)).error.hint, "serverErrors.adminRoleForbidden");
});

Deno.test("an admin can", async () => {
  const handler = createStaffHandler(deps({ identify: () => Promise.resolve(ADMIN) }));
  const response = await handler(post({ action: "create", staff: { ...NEW_STAFF, role: "admin" } }));
  assertEquals(response.status, 200);
});

// ---------------------------------------------------------------------------
//  Editing one
// ---------------------------------------------------------------------------

const EDIT = {
  fullName: "Мария Иванова",
  phone: null,
  role: "tech",
  language: "cs",
  isActive: true,
} as const;

Deno.test("a manager edits somebody on the team", async () => {
  let received: { id: string; profile: StaffProfile } | null = null;
  const handler = createStaffHandler(
    deps({
      updateStaff: (input) => {
        received = input;
        return Promise.resolve();
      },
    }),
  );

  const response = await handler(post({ action: "update", id: "s-1", staff: EDIT }));
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { success: true, data: { id: "s-1" } });
  assertEquals(received!.profile.role, "tech");
  assertEquals(received!.profile.language, "cs");
});

// English is the default for somebody new only: an edit of a person who never
// chose a language does not quietly choose English for her.
Deno.test("an edit without a language leaves it unchosen", async () => {
  let received: { id: string; profile: StaffProfile } | null = null;
  const handler = createStaffHandler(
    deps({
      updateStaff: (input) => {
        received = input;
        return Promise.resolve();
      },
    }),
  );

  const response = await handler(
    post({ action: "update", id: "s-1", staff: { ...EDIT, language: null } }),
  );
  assertEquals(response.status, 200);
  assertEquals(received!.profile.language, null);
});

Deno.test("a manager hires a head technician, and makes somebody one", async () => {
  // The role of 20261003100000: app_metadata and the profile both say it.
  const created: StaffProfile[] = [];
  const updated: StaffProfile[] = [];
  const handler = createStaffHandler(
    deps({
      createStaff: (input) => {
        created.push(input.profile);
        return Promise.resolve({ id: "new-2", sent: true, failureKey: null });
      },
      updateStaff: (input) => {
        updated.push(input.profile);
        return Promise.resolve();
      },
    }),
  );

  const hired = await handler(
    post({ action: "create", staff: { ...NEW_STAFF, role: "head_tech" } }),
  );
  const promoted = await handler(
    post({ action: "update", id: "s-1", staff: { ...EDIT, role: "head_tech" } }),
  );

  assertEquals([hired.status, promoted.status], [200, 200]);
  assertEquals([created[0].role, updated[0].role], ["head_tech", "head_tech"]);
});

Deno.test("switching somebody off is an explicit flag, never an omission", async () => {
  const handler = createStaffHandler(deps());

  const missing = await handler(
    post({ action: "update", id: "s-1", staff: { ...EDIT, isActive: undefined } }),
  );
  assertEquals(missing.status, 400);
  assertEquals((await refusalOf(missing)).error.hint, "serverErrors.staffPayloadInvalid");

  let profile: StaffProfile | null = null;
  const off = createStaffHandler(
    deps({
      updateStaff: (input) => {
        profile = input.profile;
        return Promise.resolve();
      },
    }),
  );
  await off(post({ action: "update", id: "s-1", staff: { ...EDIT, isActive: false } }));
  assertEquals(profile!.isActive, false);
});

Deno.test("somebody in another company is simply not there", async () => {
  const handler = createStaffHandler(
    deps({ findStaff: () => Promise.resolve({ ...MARIA, hostId: "host-2" }) }),
  );
  const response = await handler(post({ action: "update", id: "s-1", staff: EDIT }));
  assertEquals(response.status, 404);
  assertEquals((await refusalOf(response)).error.hint, "serverErrors.staffNotFound");
});

Deno.test("a manager may not touch an admin", async () => {
  const handler = createStaffHandler(
    deps({ findStaff: () => Promise.resolve({ ...MARIA, role: "admin" }) }),
  );
  const response = await handler(
    post({ action: "update", id: "s-1", staff: { ...EDIT, role: "admin" } }),
  );
  assertEquals(response.status, 403);
  assertEquals((await refusalOf(response)).error.hint, "serverErrors.adminRoleForbidden");
});

Deno.test("a manager cannot demote herself or switch herself off", async () => {
  const self: StaffMember = {
    id: MANAGER.id,
    email: "boss@example.com",
    fullName: "Boss",
    hostId: "host-1",
    role: "manager",
    isActive: true,
  };
  const handler = createStaffHandler(deps({ findStaff: () => Promise.resolve(self) }));

  const demote = await handler(
    post({ action: "update", id: MANAGER.id, staff: { ...EDIT, role: "cleaner" } }),
  );
  assertEquals(demote.status, 403);
  assertEquals((await refusalOf(demote)).error.hint, "serverErrors.staffSelfChange");

  const disable = await handler(
    post({ action: "update", id: MANAGER.id, staff: { ...EDIT, role: "manager", isActive: false } }),
  );
  assertEquals(disable.status, 403);
  assertEquals((await refusalOf(disable)).error.hint, "serverErrors.staffSelfChange");
});

Deno.test("but she may correct her own name and language", async () => {
  const self: StaffMember = {
    id: MANAGER.id,
    email: "boss@example.com",
    fullName: "Boss",
    hostId: "host-1",
    role: "manager",
    isActive: true,
  };
  const handler = createStaffHandler(deps({ findStaff: () => Promise.resolve(self) }));
  const response = await handler(
    post({ action: "update", id: MANAGER.id, staff: { ...EDIT, role: "manager" } }),
  );
  assertEquals(response.status, 200);
});

// ---------------------------------------------------------------------------
//  A new password
// ---------------------------------------------------------------------------

Deno.test("a reset makes a password from the person it belongs to and posts it", async () => {
  let received: { id: string; email: string; fullName: string | null; password: string } | null =
    null;
  const handler = createStaffHandler(
    deps({
      makePassword: (fullName, email) => `${fullName}:${email}`,
      setPassword: (input) => {
        received = input;
        return Promise.resolve({ sent: true, failureKey: null });
      },
    }),
  );

  const response = await handler(post({ action: "reset_password", id: "s-1" }));

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    success: true,
    data: {
      id: "s-1",
      password: "Мария:maria@example.com",
      emailSent: true,
      mailFailureKey: null,
    },
  });
  assertEquals(received!.email, "maria@example.com");
});

Deno.test("a reset for nobody is refused", async () => {
  const response = await createStaffHandler(deps())(post({ action: "reset_password", id: "who-1" }));
  assertEquals(response.status, 404);
  assertEquals((await refusalOf(response)).error.hint, "serverErrors.staffNotFound");
});

Deno.test("a reset that names nobody at all is refused", async () => {
  const response = await createStaffHandler(deps())(post({ action: "reset_password" }));
  assertEquals(response.status, 400);
  assertEquals((await refusalOf(response)).error.hint, "serverErrors.staffPayloadInvalid");
});

Deno.test("the new password is shown even when the letter did not go", async () => {
  const handler = createStaffHandler(
    deps({ setPassword: () => Promise.resolve({ sent: false, failureKey: "serverErrors.mailTooSoon" }) }),
  );
  const response = await handler(post({ action: "reset_password", id: "s-1" }));
  const body = (await response.json()) as { data: { password: string; mailFailureKey: string } };
  assertEquals(body.data.password, "Anna-abcde");
  assertEquals(body.data.mailFailureKey, "serverErrors.mailTooSoon");
});

// ---------------------------------------------------------------------------
//  A refusal the database raised
// ---------------------------------------------------------------------------

const ROLE_BLOCKED = {
  message: "Person s-1 still holds 2 listing links and 1 open cleanings",
  hint: "serverErrors.techRoleBlocked",
  details: '{"links": 2, "cleanings": 1}',
  code: "23514",
} as const;

Deno.test("a database refusal keeps its key and its parameters", () => {
  const refusal = refusalFromDatabase(ROLE_BLOCKED);

  assert(refusal instanceof StaffRefusal);
  assertEquals(refusal.status, 409);
  assertEquals(refusal.hint, "serverErrors.techRoleBlocked");
  assertEquals(refusal.params, { links: 2, cleanings: 1 });
  assertEquals(refusal.message, ROLE_BLOCKED.message);
});

Deno.test("a database failure without a key of ours stays an error", () => {
  assertEquals(refusalFromDatabase({ message: "connection reset" }), null);
  assertEquals(refusalFromDatabase({ message: "boom", hint: null, details: null }), null);
  // PostgREST's own hints are prose for a developer, not a key.
  assertEquals(
    refusalFromDatabase({ message: "column x", hint: "Perhaps you meant to reference y." }),
    null,
  );
});

Deno.test("parameters that are not a JSON object are dropped, the key is kept", () => {
  assertEquals(refusalFromDatabase({ ...ROLE_BLOCKED, details: "not json" })?.params, null);
  assertEquals(refusalFromDatabase({ ...ROLE_BLOCKED, details: "[1, 2]" })?.params, null);
  assertEquals(refusalFromDatabase({ ...ROLE_BLOCKED, details: "" })?.params, null);
  assertEquals(
    refusalFromDatabase({ ...ROLE_BLOCKED, details: "not json" })?.hint,
    "serverErrors.techRoleBlocked",
  );
});

Deno.test("an edit the database refuses reaches the panel as a refusal it can read", async () => {
  const handler = createStaffHandler(
    deps({ updateStaff: () => Promise.reject(refusalFromDatabase(ROLE_BLOCKED)) }),
  );

  const response = await handler(post({ action: "update", id: "s-1", staff: EDIT }));
  assertEquals(response.status, 409);
  const refusal = await refusalOf(response);
  assertEquals(refusal.error.hint, "serverErrors.techRoleBlocked");
  assertEquals(JSON.parse(refusal.error.details ?? "null"), { links: 2, cleanings: 1 });
});

// ---------------------------------------------------------------------------
//  When something below breaks
// ---------------------------------------------------------------------------

Deno.test("an unexpected failure answers 500 and says so in the log, not in a key", async () => {
  const handler = createStaffHandler(
    deps({ createStaff: () => Promise.reject(new Error("connection reset")) }),
  );
  const response = await handler(post({ action: "create", staff: NEW_STAFF }));

  assertEquals(response.status, 500);
  const refusal = await refusalOf(response);
  assertEquals(refusal.error.hint, "serverErrors.unknown");
  assertStringIncludes(refusal.error.message, "connection reset");
});

// ---------------------------------------------------------------------------
//  The block on signing in
// ---------------------------------------------------------------------------

/** What this function leaves in app_metadata beside a block of its own. */
const OUR_MARKER = { sign_in_block: "staff" } as const;

/** What `banned_until` holds, by how it got there. The handler never reads it. */
const OUR_BAN = "876000h";
const BAN_BY_HAND = "banned by hand in the Auth dashboard";
const SHORT_BAN_BY_HAND = "24h, by hand";

/** A row and an account that remember what the last save left them with. */
interface World {
  isActive: boolean;
  ban: string | null;
  appMetadata: Record<string, unknown>;
  /** What was asked of them, in order: "row", "account", "block", "lift". */
  readonly calls: string[];
  /** Everything the block and the lift carried to Auth. */
  readonly sent: SignInBlockWrite[];
}

function world(
  isActive: boolean,
  ban: string | null,
  marker: Record<string, unknown> = {},
): World {
  return {
    isActive,
    ban,
    appMetadata: { provider: "email", role: "cleaner", ...marker },
    calls: [],
    sent: [],
  };
}

/**
 * Auth's rule, models.(*User).UpdateAppMetaData: key by key, a null takes the key
 * out, and whatever the write does not name stays.
 */
function merged(
  held: Record<string, unknown>,
  updates: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries({ ...held, ...updates }).filter(([, value]) => value !== null),
  );
}

function wired(state: World, overrides: Partial<StaffDeps> = {}): StaffDeps {
  return deps({
    findStaff: (id) =>
      Promise.resolve(id === MARIA.id ? { ...MARIA, isActive: state.isActive } : null),
    updateStaff: ({ profile }) => {
      state.calls.push("row");
      state.isActive = profile.isActive;
      return Promise.resolve();
    },
    updateAccount: ({ profile }) => {
      state.calls.push("account");
      state.appMetadata = merged(state.appMetadata, { role: profile.role });
      return Promise.resolve({ appMetadata: state.appMetadata });
    },
    setSignInBlock: ({ attributes }) => {
      const isLift = attributes.ban_duration === "none";
      state.calls.push(isLift ? "lift" : "block");
      state.sent.push(attributes);
      state.ban = isLift ? null : attributes.ban_duration;
      state.appMetadata = merged(state.appMetadata, attributes.app_metadata);
      return Promise.resolve();
    },
    ...overrides,
  });
}

const authDown = () => Promise.reject(new Error("auth is down"));

const SWITCH_OFF = { action: "update", id: "s-1", staff: { ...EDIT, isActive: false } };
const SWITCH_ON = { action: "update", id: "s-1", staff: { ...EDIT, isActive: true } };

const BLOCK_FAILED = "serverErrors.staffSignInBlockFailed";
const UNBLOCK_FAILED = "serverErrors.staffSignInUnblockFailed";

Deno.test("switching somebody off blocks her sign-in and marks it, after the row", async () => {
  const state = world(true, null);
  const response = await createStaffHandler(wired(state))(post(SWITCH_OFF));

  assertEquals(response.status, 200);
  assertEquals(state.calls, ["row", "account", "block"]);
  assertEquals([state.isActive, state.ban], [false, OUR_BAN]);
  assertEquals(state.appMetadata.sign_in_block, "staff");
});

Deno.test("switching somebody back on lifts our block and clears the marker", async () => {
  const state = world(false, OUR_BAN, OUR_MARKER);
  const response = await createStaffHandler(wired(state))(post(SWITCH_ON));

  assertEquals(response.status, 200);
  assertEquals(state.calls, ["row", "account", "lift"]);
  assertEquals([state.isActive, state.ban], [true, null]);
  assertEquals("sign_in_block" in state.appMetadata, false);
});

Deno.test("a save of somebody working and unblocked asks Auth for nothing more", async () => {
  const state = world(true, null);
  const response = await createStaffHandler(wired(state))(post(SWITCH_ON));

  assertEquals(response.status, 200);
  assertEquals(state.calls, ["row", "account"]);
});

// The hole of f739306: a block is lifted only if this function set it.
Deno.test("a manager's save of a name does not lift a ban set by hand", async () => {
  const state = world(true, BAN_BY_HAND);
  const response = await createStaffHandler(wired(state))(post(SWITCH_ON));

  assertEquals(response.status, 200);
  assertEquals(state.calls, ["row", "account"]);
  assertEquals(state.sent, []);
  assertEquals(state.ban, BAN_BY_HAND);
});

// Her access token outlives the ban, so she can still reach this door.
Deno.test("somebody banned by hand cannot lift the ban by saving herself", async () => {
  const state = world(true, BAN_BY_HAND);
  const herself = { ...MARIA, id: MANAGER.id, role: "manager" };
  const handler = createStaffHandler(
    wired(state, { findStaff: () => Promise.resolve(herself) }),
  );

  const response = await handler(
    post({ action: "update", id: MANAGER.id, staff: { ...EDIT, role: "manager" } }),
  );

  assertEquals(response.status, 200);
  assertEquals(state.calls, ["row", "account"]);
  assertEquals(state.sent, []);
  assertEquals(state.ban, BAN_BY_HAND);
});

Deno.test("somebody working who carries our marker is lifted and the marker cleared", async () => {
  const state = world(true, OUR_BAN, OUR_MARKER);
  const response = await createStaffHandler(wired(state))(post(SWITCH_ON));

  assertEquals(response.status, 200);
  assertEquals(state.calls, ["row", "account", "lift"]);
  assertEquals(state.ban, null);
  assertEquals("sign_in_block" in state.appMetadata, false);
});

Deno.test("somebody off gets the block and the marker on every save", async () => {
  const state = world(false, OUR_BAN, OUR_MARKER);
  const response = await createStaffHandler(wired(state))(post(SWITCH_OFF));

  assertEquals(response.status, 200);
  assertEquals(state.calls, ["row", "account", "block"]);
  assertEquals(state.ban, OUR_BAN);
  assertEquals(state.appMetadata.sign_in_block, "staff");
});

// A short ban by hand must not pass for ours: it would run out with her still off.
Deno.test("somebody off with a short ban by hand gets the long block and the marker", async () => {
  const state = world(false, SHORT_BAN_BY_HAND);
  const response = await createStaffHandler(wired(state))(post(SWITCH_OFF));

  assertEquals(response.status, 200);
  assertEquals(state.ban, OUR_BAN);
  assertEquals(state.appMetadata.sign_in_block, "staff");
});

// The accepted limit of "always block": a switch-off makes the block ours.
Deno.test("a ban by hand does not outlive a switch-off and a switch-on", async () => {
  const state = world(true, BAN_BY_HAND);
  const handler = createStaffHandler(wired(state));

  await handler(post(SWITCH_OFF));
  await handler(post(SWITCH_ON));

  assertEquals(state.ban, null);
});

Deno.test("the role goes with the block and with the lift, and the rest stays", async () => {
  const state = world(true, null);
  const handler = createStaffHandler(wired(state));

  await handler(post(SWITCH_OFF));
  assertEquals(state.sent[0].app_metadata, { role: "tech", sign_in_block: "staff" });
  assertEquals(state.appMetadata, { provider: "email", role: "tech", sign_in_block: "staff" });

  await handler(post(SWITCH_ON));
  assertEquals(state.sent[1].app_metadata, { role: "tech", sign_in_block: null });
  assertEquals(state.appMetadata, { provider: "email", role: "tech" });
});

Deno.test("a new account gets no block and no lift", async () => {
  const state = world(true, null);
  const response = await createStaffHandler(wired(state))(
    post({ action: "create", staff: { ...NEW_STAFF, isActive: false } }),
  );

  assertEquals(response.status, 200);
  assertEquals(state.calls, []);
});

// The row stays written: an outage of Auth must not keep somebody who was let go
// inside the company's data. What it must not do is pass in silence.
Deno.test("a block Auth refuses tells the manager, and the row stays off", async () => {
  const state = world(true, null);
  const handler = createStaffHandler(wired(state, { setSignInBlock: authDown }));

  const response = await handler(post(SWITCH_OFF));

  assertEquals(response.status, 500);
  const refusal = await refusalOf(response);
  assertEquals(refusal.success, false);
  assertEquals(refusal.error.hint, BLOCK_FAILED);
  assertEquals([state.isActive, state.ban], [false, null]);
});

// Auth being down fails at its first call, the account write, not at the block.
Deno.test("an account write Auth refuses on a switch-off tells the manager too", async () => {
  const state = world(true, null);
  const handler = createStaffHandler(wired(state, { updateAccount: authDown }));

  const response = await handler(post(SWITCH_OFF));

  assertEquals(response.status, 500);
  assertEquals((await refusalOf(response)).error.hint, BLOCK_FAILED);
  assertEquals(state.calls, ["row"]);
});

Deno.test("a lift Auth refuses tells the manager, and the row stays on", async () => {
  const state = world(false, OUR_BAN, OUR_MARKER);
  const handler = createStaffHandler(wired(state, { setSignInBlock: authDown }));

  const response = await handler(post(SWITCH_ON));

  assertEquals(response.status, 500);
  assertEquals((await refusalOf(response)).error.hint, UNBLOCK_FAILED);
  assertEquals([state.isActive, state.ban], [true, OUR_BAN]);
  assertEquals(state.appMetadata.sign_in_block, "staff");
});

Deno.test("an account write Auth refuses on a switch-on tells the manager too", async () => {
  const state = world(false, OUR_BAN, OUR_MARKER);
  const handler = createStaffHandler(wired(state, { updateAccount: authDown }));

  const response = await handler(post(SWITCH_ON));

  assertEquals(response.status, 500);
  assertEquals((await refusalOf(response)).error.hint, UNBLOCK_FAILED);
  assertEquals(state.calls, ["row"]);
});

Deno.test("an account write Auth refuses on a plain edit stays a general failure", async () => {
  const state = world(true, null);
  const handler = createStaffHandler(wired(state, { updateAccount: authDown }));

  const response = await handler(post(SWITCH_ON));

  assertEquals(response.status, 500);
  assertEquals((await refusalOf(response)).error.hint, "serverErrors.unknown");
});

// After the failed block the row already says "off", so this save changes
// nothing in the row and still has to finish the work.
Deno.test("the same save again repairs a block that failed", async () => {
  const state = world(true, null);
  const healthy = wired(state);
  let isAuthDown = true;
  const handler = createStaffHandler({
    ...healthy,
    setSignInBlock: (input) => isAuthDown ? authDown() : healthy.setSignInBlock(input),
  });

  assertEquals((await handler(post(SWITCH_OFF))).status, 500);
  isAuthDown = false;
  const repaired = await handler(post(SWITCH_OFF));

  assertEquals(repaired.status, 200);
  assertEquals([state.isActive, state.ban], [false, OUR_BAN]);
  assertEquals(state.appMetadata.sign_in_block, "staff");
});

// The marker is what a failed lift leaves behind, so the repeat knows the block
// is ours, and once it is gone the next save has nothing left to do.
Deno.test("the same save again repairs a lift that failed, and then rests", async () => {
  const state = world(false, OUR_BAN, OUR_MARKER);
  const healthy = wired(state);
  let isAuthDown = true;
  const handler = createStaffHandler({
    ...healthy,
    setSignInBlock: (input) => isAuthDown ? authDown() : healthy.setSignInBlock(input),
  });

  assertEquals((await handler(post(SWITCH_ON))).status, 500);
  isAuthDown = false;
  const repaired = await handler(post(SWITCH_ON));

  assertEquals(repaired.status, 200);
  assertEquals([state.isActive, state.ban], [true, null]);

  const callsBefore = state.calls.length;
  assertEquals((await handler(post(SWITCH_ON))).status, 200);
  assertEquals(state.calls.slice(callsBefore), ["row", "account"]);
});

Deno.test("a repeat also repairs what an account write left undone", async () => {
  const state = world(true, null);
  const healthy = wired(state);
  let isAuthDown = true;
  const handler = createStaffHandler({
    ...healthy,
    updateAccount: (input) => isAuthDown ? authDown() : healthy.updateAccount(input),
  });

  assertEquals((await handler(post(SWITCH_OFF))).status, 500);
  isAuthDown = false;

  assertEquals((await handler(post(SWITCH_OFF))).status, 200);
  assertEquals([state.isActive, state.ban], [false, OUR_BAN]);
});

// Everybody switched off before this rule, until the one-off backfill reaches them.
Deno.test("an edit of somebody switched off who was never blocked blocks her", async () => {
  const state = world(false, null);
  const response = await createStaffHandler(wired(state))(post(SWITCH_OFF));

  assertEquals(response.status, 200);
  assertEquals(state.calls, ["row", "account", "block"]);
});

Deno.test("a switch-off the database refuses leaves Auth alone", async () => {
  const state = world(true, null);
  const handler = createStaffHandler(
    wired(state, { updateStaff: () => Promise.reject(refusalFromDatabase(ROLE_BLOCKED)) }),
  );

  const response = await handler(post(SWITCH_OFF));

  assertEquals(response.status, 409);
  assertEquals((await refusalOf(response)).error.hint, "serverErrors.techRoleBlocked");
  assertEquals(state.calls, []);
});

Deno.test("every guard refuses before the row and before Auth", async () => {
  const self: StaffMember = { ...MARIA, id: MANAGER.id, role: "manager" };
  const cases: readonly [string, Partial<StaffDeps>, unknown, string][] = [
    [
      "a cleaner",
      { identify: () => Promise.resolve({ ...MANAGER, role: "cleaner" }) },
      SWITCH_OFF,
      "serverErrors.managerOnly",
    ],
    [
      "a manager switched off",
      { identify: () => Promise.resolve({ ...MANAGER, isActive: false }) },
      SWITCH_OFF,
      "serverErrors.managerOnly",
    ],
    [
      "no flag",
      {},
      { ...SWITCH_OFF, staff: { ...EDIT, isActive: undefined } },
      "serverErrors.staffPayloadInvalid",
    ],
    [
      "another company",
      { findStaff: () => Promise.resolve({ ...MARIA, hostId: "host-2" }) },
      SWITCH_OFF,
      "serverErrors.staffNotFound",
    ],
    [
      "an admin, by a manager",
      { findStaff: () => Promise.resolve({ ...MARIA, role: "admin" }) },
      SWITCH_OFF,
      "serverErrors.adminRoleForbidden",
    ],
    [
      "the admin role, by a manager",
      {},
      { ...SWITCH_OFF, staff: { ...EDIT, role: "admin", isActive: false } },
      "serverErrors.adminRoleForbidden",
    ],
    [
      "herself",
      { findStaff: () => Promise.resolve(self) },
      { action: "update", id: MANAGER.id, staff: { ...EDIT, role: "manager", isActive: false } },
      "serverErrors.staffSelfChange",
    ],
  ];

  for (const [who, overrides, body, hint] of cases) {
    const state = world(true, null);
    const response = await createStaffHandler(wired(state, overrides))(post(body));

    assertEquals((await refusalOf(response)).error.hint, hint, who);
    assertEquals(state.calls, [], who);
  }
});

Deno.test("the block lasts until somebody lifts it, in words Auth reads", async () => {
  const state = world(true, null);
  const handler = createStaffHandler(wired(state));

  await handler(post(SWITCH_OFF));
  await handler(post(SWITCH_ON));

  assertEquals(state.sent[1].ban_duration, "none");

  const hours = Number(/^(\d+)h$/.exec(state.sent[0].ban_duration)?.[1]);
  assert(hours >= 50 * 365 * 24, `${hours} hours is not "until enabled again"`);
  // Auth parses this as a Go duration, which ends at about 292 years.
  assert(hours < 2_562_047, `${hours} hours does not fit a Go duration`);
});
