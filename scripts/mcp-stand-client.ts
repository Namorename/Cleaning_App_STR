// The MCP server on the LOCAL stand, driven by the official MCP clients
// (docs/mcp-server.md §8). Nothing here reaches the cloud: the server is
// scripts/api-stand-server.ts in serve mode, whose transaction is never
// committed, and the keys are the ones it wrote to a file (never printed).
//
//   npx deno run --node-modules-dir=none --no-lock --allow-net=127.0.0.1,registry.npmjs.org \
//     --allow-read --allow-env --allow-sys scripts/mcp-stand-client.ts --keys <file>
//
// The clients, pinned: the TypeScript SDK v1 (speaks the 2025 handshake,
// up to 2025-11-25) and the v2 client (2026-07-28 without a handshake, or
// the 2025 one in its legacy mode). Exits 0 when every check holds.

import { Client as ClientV1 } from "npm:@modelcontextprotocol/sdk@1.32.1/client/index.js";
import { StreamableHTTPClientTransport as TransportV1 } from "npm:@modelcontextprotocol/sdk@1.32.1/client/streamableHttp.js";
import * as v2 from "npm:@modelcontextprotocol/client@2.3.1";

const URL_ = new URL("http://127.0.0.1:8788/mcp");

function argOf(name: string): string | null {
  const i = Deno.args.indexOf(name);
  return i >= 0 && i + 1 < Deno.args.length ? Deno.args[i + 1] : null;
}

const keysFile = argOf("--keys");
if (keysFile === null) {
  console.error("Usage: scripts/mcp-stand-client.ts --keys <file written by api-stand-server.ts serve>");
  Deno.exit(2);
}
const keys = JSON.parse(await Deno.readTextFile(keysFile)) as Record<string, string>;

let failures = 0;
let checked = 0;
function check(label: string, ok: boolean, detail = ""): void {
  checked += 1;
  if (!ok) {
    failures += 1;
  }
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail === "" ? "" : ` — ${detail}`}`);
}

interface AnyClient {
  listTools(): Promise<{ tools: { name: string; annotations?: Record<string, unknown> }[] }>;
  callTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

type Flavour = "v1" | "v2-legacy" | "v2-modern";

async function connect(flavour: Flavour, key: string): Promise<AnyClient> {
  const requestInit = { headers: { Authorization: `Bearer ${key}` } };
  if (flavour === "v1") {
    const client = new ClientV1({ name: "woom-stand-check", version: "1.0.0" });
    await client.connect(new TransportV1(URL_, { requestInit }));
    return client as unknown as AnyClient;
  }
  const sdk = v2 as unknown as Record<string, new (...args: unknown[]) => Record<string, unknown>>;
  const client = new sdk.Client(
    { name: "woom-stand-check", version: "1.0.0" },
    { mode: flavour === "v2-modern" ? "modern" : "legacy" },
  );
  const transport = new sdk.StreamableHTTPClientTransport(URL_, { requestInit });
  await (client.connect as (transport: unknown) => Promise<void>)(transport);
  return client as unknown as AnyClient;
}

function structured(result: Record<string, unknown>): Record<string, unknown> {
  const content = result.content as { type: string; text: string }[];
  return JSON.parse(content[0].text) as Record<string, unknown>;
}

async function errorOf(work: () => Promise<unknown>): Promise<string> {
  try {
    const result = await work();
    return `no error (${JSON.stringify(result).slice(0, 80)})`;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function run(flavour: Flavour): Promise<void> {
  console.log(`--- ${flavour}`);

  // A read-only key: reads only, and what it says of itself leaves out its prefix.
  const reader = await connect(flavour, keys.read_only);
  const readerTools = (await reader.listTools()).tools;
  check(`${flavour}: read_only lists get_me and reads`, readerTools.some((tool) => tool.name === "list_cleanings"));
  check(
    `${flavour}: read_only lists no write`,
    readerTools.every((tool) => tool.annotations?.readOnlyHint === true),
    readerTools.map((tool) => tool.name).join(","),
  );
  const me = structured(await reader.callTool({ name: "get_me", arguments: {} }));
  const meKey = (me.data as Record<string, unknown>).key as Record<string, unknown>;
  check(`${flavour}: get_me answers without the key's prefix`, meKey.prefix === undefined && meKey.name !== undefined);
  check(`${flavour}: every answer carries the data notice`, typeof me.data_notice === "string");
  const page = await reader.callTool({ name: "list_cleanings", arguments: { limit: 2 } });
  const pageJson = structured(page);
  check(
    `${flavour}: list_cleanings answers a page of at most 2`,
    page.isError !== true && Array.isArray(pageJson.data) && (pageJson.data as unknown[]).length <= 2,
  );
  const wrongArgs = await reader.callTool({ name: "get_cleaning", arguments: { cleaning: "x" } });
  check(`${flavour}: arguments that do not fit are a tool error`, wrongArgs.isError === true);
  await reader.close();

  // A key with one scope: one family of tools, and the others are unknown.
  const custom = await connect(flavour, keys.custom);
  const customTools = (await custom.listTools()).tools.map((tool) => tool.name).sort();
  check(
    `${flavour}: custom (cleanings:read) lists exactly its tools`,
    JSON.stringify(customTools) === JSON.stringify(["get_cleaning", "get_me", "list_cleanings"]),
    customTools.join(","),
  );
  const refused = await errorOf(() => custom.callTool({ name: "list_tasks", arguments: {} }));
  check(`${flavour}: a tool outside the key's scopes is unknown`, /Unknown tool|-32602/.test(refused), refused);
  await custom.close();

  // A wrong key is refused at the door.
  const wrong = await errorOf(() => connect(flavour, `woom_${"Z".repeat(43)}`));
  check(`${flavour}: a wrong key cannot connect`, !wrong.startsWith("no error"), wrong.slice(0, 120));

  // Another company's key sees another company.
  const other = await connect(flavour, keys.other);
  const otherMe = structured(await other.callTool({ name: "get_me", arguments: {} }));
  const company = ((otherMe.data as Record<string, unknown>).company as Record<string, unknown>).id;
  const ownCompany = ((me.data as Record<string, unknown>).company as Record<string, unknown>).id;
  check(`${flavour}: another company's key is another company`, company !== ownCompany);
  await other.close();

  // An operator writes once; the same idempotency key replays, not repeats.
  const operator = await connect(flavour, keys.operator);
  const idempotencyKey = `${flavour}-${crypto.randomUUID()}`;
  const args = { idempotency_key: idempotencyKey, title: `MCP stand check (${flavour})`, priority: "low" };
  const first = await operator.callTool({ name: "create_task", arguments: args });
  const again = await operator.callTool({ name: "create_task", arguments: args });
  const firstJson = structured(first);
  const againJson = structured(again);
  check(
    `${flavour}: create_task writes a task`,
    first.isError !== true && typeof (firstJson.data as Record<string, unknown> | undefined)?.id === "string",
    first.isError === true ? JSON.stringify(firstJson.error).slice(0, 160) : "",
  );
  check(
    `${flavour}: the same idempotency key replays the same task`,
    againJson.replayed === true &&
      (againJson.data as Record<string, unknown>)?.id === (firstJson.data as Record<string, unknown>)?.id,
  );
  await operator.close();
}

for (const flavour of ["v1", "v2-legacy", "v2-modern"] as const) {
  try {
    await run(flavour);
  } catch (error) {
    check(`${flavour}: the run finished`, false, error instanceof Error ? error.message.slice(0, 200) : String(error));
  }
}
console.log(`${checked - failures} of ${checked} checks held`);
Deno.exit(failures === 0 ? 0 : 1);
