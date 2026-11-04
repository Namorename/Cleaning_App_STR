import { assert, assertEquals } from "jsr:@std/assert@1";

import { ROUTES } from "../api/routes.ts";
import { CATALOG } from "./catalog.ts";
import { listTools } from "./tools.ts";

/**
 * The MCP tools and the API's operations are one list (docs/mcp-server.md §3):
 * catalog.ts is built from the spec, and routes.ts is what the API serves, so
 * here the two meet. A new operation, a renamed parameter or a changed scope
 * on one side and not the other fails here — and the panel's parity test
 * holds catalog.ts to the build (npm run api:docs).
 */

const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;

Deno.test("there is one tool per operation of the API, and no other", () => {
  const operations = ROUTES.map((route) => route.operationId).sort();
  const tools = CATALOG.tools.map((tool) => tool.operationId).sort();
  assertEquals(tools, operations);
  assertEquals(new Set(CATALOG.tools.map((tool) => tool.name)).size, CATALOG.tools.length);
  for (const tool of CATALOG.tools) {
    assert(TOOL_NAME.test(tool.name), `${tool.name} is not a plain tool name`);
  }
});

Deno.test("each tool is its operation: method, path, scope, kind", () => {
  for (const route of ROUTES) {
    const tool = CATALOG.tools.find((candidate) => candidate.operationId === route.operationId);
    assert(tool !== undefined, route.operationId);
    assertEquals([tool.method, tool.path, tool.scope], [route.method, route.path, route.scope], route.operationId);
    assertEquals(tool.kind === "write", route.kind === "write", route.operationId);
    assertEquals(tool.annotations.readOnlyHint, route.kind !== "write", route.operationId);
  }
});

Deno.test("each tool takes its operation's parameters and body, by the same names", () => {
  for (const route of ROUTES) {
    const tool = CATALOG.tools.find((candidate) => candidate.operationId === route.operationId);
    assert(tool !== undefined, route.operationId);
    const wires = (place: string) => tool.args.filter((arg) => arg.place === place).map((arg) => arg.wire).sort();
    const pathNames = [...route.path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]).sort();
    const queryNames = route.params.map((param) => param.name).filter((name) => !pathNames.includes(name));
    const paging = route.cursor === undefined ? [] : ["cursor", "limit"];

    assertEquals(wires("path"), pathNames, `${route.operationId}: path`);
    assertEquals(wires("query"), [...queryNames, ...paging].sort(), `${route.operationId}: query`);
    assertEquals(wires("body"), (route.body ?? []).map((field) => field.name).sort(), `${route.operationId}: body`);
    assertEquals(wires("header"), route.kind === "write" ? ["Idempotency-Key"] : [], `${route.operationId}: header`);
    assertEquals(tool.paged, route.cursor !== undefined, `${route.operationId}: paged`);

    const required = new Set((tool.inputSchema.required ?? []) as string[]);
    for (const param of [...route.params, ...(route.body ?? [])]) {
      assertEquals(required.has(param.name), param.required === true, `${route.operationId}: ${param.name} required`);
    }
  }
});

Deno.test("a key sees exactly the tools of the operations its scopes open", () => {
  const scopes = [...new Set(ROUTES.map((route) => route.scope).filter((scope) => scope !== null))] as string[];
  for (const scope of scopes) {
    const listed = listTools([scope]).map((tool) => tool.name);
    const expected = CATALOG.tools.filter((tool) => tool.scope === null || tool.scope === scope).map((tool) =>
      tool.name
    );
    assertEquals(listed, expected, scope);
  }
  assertEquals(listTools([]).map((tool) => tool.name), ["get_me"]);
});

Deno.test("a tool's input schema is plain JSON Schema: an object, no references, no OpenAPI words", () => {
  const text = JSON.stringify(CATALOG.tools.map((tool) => tool.inputSchema));
  assert(!text.includes("$ref"));
  assert(!text.includes('"example"'));
  assert(!text.includes('"x-'));
  for (const tool of CATALOG.tools) {
    assertEquals(tool.inputSchema.type, "object", tool.name);
    assertEquals(tool.inputSchema.additionalProperties, false, tool.name);
  }
});
