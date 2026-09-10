import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  type Caller,
  createStaffHandler,
  type StaffDeps,
  type StaffMember,
  type StaffProfile,
} from "./handler.ts";

const MANAGER: Caller = { id: "m-1", role: "manager", hostId: "host-1", isActive: true };
const ADMIN: Caller = { id: "a-1", role: "admin", hostId: "host-1", isActive: true };

const MARIA: StaffMember = {
  id: "s-1",
  email: "maria@example.com",
  fullName: "Мария",
  hostId: "host-1",
  role: "cleaner",
};

/** Everything succeeds and nothing is recorded, unless a test says otherwise. */
function deps(overrides: Partial<StaffDeps> = {}): StaffDeps {
  return {
    identify: () => Promise.resolve(MANAGER),
    findStaff: (id) => Promise.resolve(id === MARIA.id ? MARIA : null),
    createStaff: () => Promise.resolve({ id: "new-1", sent: true, failureKey: null }),
    updateStaff: () => Promise.resolve(),
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

Deno.test("a person may be created without a language — nothing has been chosen yet", async () => {
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
  assertEquals(profile!.language, null);
  assertEquals(profile!.phone, null);
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
