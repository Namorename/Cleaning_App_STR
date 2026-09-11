import { assertEquals } from "jsr:@std/assert@1";
import { allowsSync, CORS_HEADERS, readBearer } from "./caller.ts";

const SERVICE_KEY = "service-key-for-the-scheduler";

function request(authorization?: string): Request {
  return new Request("https://example.test/sync-listings", {
    method: "POST",
    headers: authorization === undefined ? {} : { Authorization: authorization },
  });
}

/** Nobody is looked up unless the test says so. */
const neverAsked = () => Promise.reject(new Error("auth should not have been asked"));

Deno.test("the token is read out of the Bearer header", () => {
  assertEquals(readBearer(request("Bearer abc.def.ghi")), "abc.def.ghi");
  // Casing and padding come from whoever wrote the client, not from us.
  assertEquals(readBearer(request("bearer   abc  ")), "abc");
});

Deno.test("a header that is not a Bearer token gives nothing", () => {
  assertEquals(readBearer(request()), null);
  assertEquals(readBearer(request("Basic dXNlcjpwYXNz")), null);
  assertEquals(readBearer(request("Bearer")), null);
});

Deno.test("the scheduler is recognised by its key, without asking auth", async () => {
  const allowed = await allowsSync({
    token: SERVICE_KEY,
    serviceKey: SERVICE_KEY,
    roleOf: neverAsked,
  });

  assertEquals(allowed, true);
});

Deno.test("a manager may start a sync", async () => {
  assertEquals(
    await allowsSync({
      token: "manager-token",
      serviceKey: SERVICE_KEY,
      roleOf: () => Promise.resolve("manager"),
    }),
    true,
  );
});

Deno.test("and so may an admin", async () => {
  assertEquals(
    await allowsSync({
      token: "admin-token",
      serviceKey: SERVICE_KEY,
      roleOf: () => Promise.resolve("admin"),
    }),
    true,
  );
});

Deno.test("a cleaner may not — a full Hostaway sync is not hers to start", async () => {
  assertEquals(
    await allowsSync({
      token: "cleaner-token",
      serviceKey: SERVICE_KEY,
      roleOf: () => Promise.resolve("cleaner"),
    }),
    false,
  );
});

Deno.test("a token that belongs to nobody is refused", async () => {
  assertEquals(
    await allowsSync({
      token: "stale-token",
      serviceKey: SERVICE_KEY,
      roleOf: () => Promise.resolve(null),
    }),
    false,
  );
});

Deno.test("no token at all is refused before anything is looked up", async () => {
  assertEquals(
    await allowsSync({ token: null, serviceKey: SERVICE_KEY, roleOf: neverAsked }),
    false,
  );
  assertEquals(await allowsSync({ token: "", serviceKey: SERVICE_KEY, roleOf: neverAsked }), false);
});

Deno.test("an empty service key never matches, so a blank token cannot pass as the scheduler", async () => {
  assertEquals(
    await allowsSync({ token: "anything", serviceKey: "", roleOf: () => Promise.resolve(null) }),
    false,
  );
});

Deno.test("the preflight answer names the headers supabase-js actually sends", () => {
  assertEquals(CORS_HEADERS["Access-Control-Allow-Origin"], "*");
  assertEquals(CORS_HEADERS["Access-Control-Allow-Headers"].includes("authorization"), true);
  assertEquals(CORS_HEADERS["Access-Control-Allow-Headers"].includes("apikey"), true);
  assertEquals(CORS_HEADERS["Access-Control-Allow-Methods"].includes("OPTIONS"), true);
});
