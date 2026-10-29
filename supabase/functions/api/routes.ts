/**
 * The operations of API v1, one entry each (docs/api-v1.md §1).
 *
 * This table and packages/shared/src/api/openapi.v1.yaml must say the same
 * thing: contract.test.ts holds them together one to one — method, path,
 * operationId, scope, parameters and the body's fields. A new operation is a
 * row here, an operation in the spec, a scope in the registry and an api_v1_*
 * function in a migration, in the same change (CLAUDE.md, «Паритет API»).
 */

import type { ParamSpec } from "./params.ts";

export type RouteKind = "list" | "item" | "write";

export interface CursorSpec {
  /** Reads the sort key of an item as the database returned it. */
  readonly keyOf: (item: Record<string, unknown>) => readonly [string | number, string | number] | null;
  /** The RPC arguments the two halves of a cursor go to. */
  readonly args: readonly [string, string];
  /** How each half is checked on the way back in. */
  readonly kinds: readonly [ParamSpec["kind"], ParamSpec["kind"]];
}

export interface Route {
  readonly operationId: string;
  readonly method: "GET" | "POST";
  /** OpenAPI path template, e.g. /v1/cleanings/{id}. */
  readonly path: string;
  /** Null only for getMe: any working key may ask about itself. */
  readonly scope: string | null;
  readonly fn: string;
  readonly kind: RouteKind;
  readonly params: readonly ParamSpec[];
  readonly body?: readonly ParamSpec[];
  readonly cursor?: CursorSpec;
  /** For writes: the id of what was written, for the request log. */
  readonly objectIdOf?: (body: Record<string, unknown>) => string | null;
}

const TASK_STATUS = ["unassigned", "assigned", "accepted", "in_progress", "paused", "blocked", "done", "cancelled", "expired"];
const TASK_TYPE = ["cleaning", "maintenance", "inspection", "midstay"];
const PROPERTY_STATUS = ["active", "maintenance", "archived"];
const PROBLEM_STATUS = ["open", "assigned", "in_progress", "resolved", "cancelled"];
const PROBLEM_PRIORITY = ["low", "normal", "high"];
const STAFF_ROLE = ["cleaner", "tech", "head_tech", "manager", "admin"];
const CHANNEL = ["airbnb", "booking", "vrbo", "direct", "google", "other"];

const PATH_UUID = (arg: string): ParamSpec => ({ name: "id", arg, kind: "uuid", required: true });
const PATH_ID = (arg: string): ParamSpec => ({ name: "id", arg, kind: "id", required: true });
const UPDATED_SINCE: ParamSpec = { name: "updated_since", arg: "p_updated_since", kind: "datetime" };

function stringField(item: Record<string, unknown>, name: string): string | null {
  const value = item[name];
  return typeof value === "string" ? value : null;
}

function idField(item: Record<string, unknown>): string | number | null {
  const value = item.id;
  return typeof value === "string" || typeof value === "number" ? value : null;
}

const byId = (kind: ParamSpec["kind"]): CursorSpec => ({
  keyOf: (item) => {
    const id = idField(item);
    return id === null ? null : [id, id];
  },
  args: ["p_after_id", "p_after_id"],
  kinds: [kind, kind],
});

const byField = (field: string, arg: string, kind: ParamSpec["kind"], idKind: ParamSpec["kind"]): CursorSpec => ({
  keyOf: (item) => {
    const value = stringField(item, field);
    const id = idField(item);
    return value === null || id === null ? null : [value, id];
  },
  args: [arg, "p_after_id"],
  kinds: [kind, idKind],
});

const writeId = (body: Record<string, unknown>) => {
  const id = body.id;
  return typeof id === "string" || typeof id === "number" ? String(id) : null;
};

export const ROUTES: readonly Route[] = [
  {
    operationId: "getMe",
    method: "GET",
    path: "/v1/me",
    scope: null,
    fn: "api_v1_get_me",
    kind: "item",
    params: [],
  },
  {
    operationId: "listProperties",
    method: "GET",
    path: "/v1/properties",
    scope: "properties:read",
    fn: "api_v1_list_properties",
    kind: "list",
    params: [
      { name: "status", arg: "p_status", kind: "text", list: true, enum: PROPERTY_STATUS },
      { name: "parent_id", arg: "p_parent_id", kind: "id" },
      UPDATED_SINCE,
    ],
    cursor: byId("id"),
  },
  {
    operationId: "getProperty",
    method: "GET",
    path: "/v1/properties/{id}",
    scope: "properties:read",
    fn: "api_v1_get_property",
    kind: "item",
    params: [PATH_ID("p_id")],
  },
  {
    operationId: "listCleanings",
    method: "GET",
    path: "/v1/cleanings",
    scope: "cleanings:read",
    fn: "api_v1_list_cleanings",
    kind: "list",
    params: [
      { name: "date_from", arg: "p_date_from", kind: "date" },
      { name: "date_to", arg: "p_date_to", kind: "date" },
      { name: "property_id", arg: "p_property_id", kind: "id" },
      { name: "assignee_id", arg: "p_assignee_id", kind: "uuid" },
      { name: "status", arg: "p_status", kind: "text", list: true, enum: TASK_STATUS },
      { name: "type", arg: "p_type", kind: "text", list: true, enum: TASK_TYPE },
      UPDATED_SINCE,
    ],
    cursor: byField("scheduled_date", "p_after_date", "date", "uuid"),
  },
  {
    operationId: "getCleaning",
    method: "GET",
    path: "/v1/cleanings/{id}",
    scope: "cleanings:read",
    fn: "api_v1_get_cleaning",
    kind: "item",
    params: [PATH_UUID("p_id")],
  },
  {
    operationId: "assignCleaning",
    method: "POST",
    path: "/v1/cleanings/{id}/assign",
    scope: "cleanings:assign",
    fn: "api_v1_assign_cleaning",
    kind: "write",
    params: [PATH_UUID("p_cleaning_id")],
    body: [{ name: "assignee_id", arg: "p_assignee_id", kind: "uuid", required: true, nullable: true }],
    objectIdOf: writeId,
  },
  {
    operationId: "listCleaningMedia",
    method: "GET",
    path: "/v1/cleanings/{id}/media",
    scope: "media:read",
    fn: "api_v1_list_cleaning_media",
    kind: "list",
    params: [PATH_UUID("p_cleaning_id")],
  },
  {
    operationId: "listTasks",
    method: "GET",
    path: "/v1/tasks",
    scope: "tasks:read",
    fn: "api_v1_list_tasks",
    kind: "list",
    params: [
      { name: "status", arg: "p_status", kind: "text", list: true, enum: PROBLEM_STATUS },
      { name: "priority", arg: "p_priority", kind: "text", list: true, enum: PROBLEM_PRIORITY },
      { name: "property_id", arg: "p_property_id", kind: "id" },
      { name: "assignee_id", arg: "p_assignee_id", kind: "uuid" },
      { name: "created_from", arg: "p_created_from", kind: "datetime" },
      { name: "created_to", arg: "p_created_to", kind: "datetime" },
      { name: "include_archived", arg: "p_include_archived", kind: "boolean" },
      UPDATED_SINCE,
    ],
    cursor: byField("_sort", "p_after_created", "datetime", "uuid"),
  },
  {
    operationId: "getTask",
    method: "GET",
    path: "/v1/tasks/{id}",
    scope: "tasks:read",
    fn: "api_v1_get_task",
    kind: "item",
    params: [PATH_UUID("p_id")],
  },
  {
    operationId: "createTask",
    method: "POST",
    path: "/v1/tasks",
    scope: "tasks:create",
    fn: "api_v1_create_task",
    kind: "write",
    params: [],
    body: [
      { name: "title", arg: "p_title", kind: "text", required: true, maxLength: 200 },
      { name: "description", arg: "p_description", kind: "text", nullable: true, maxLength: 4000 },
      { name: "priority", arg: "p_priority", kind: "text", enum: PROBLEM_PRIORITY },
      { name: "property_id", arg: "p_property_id", kind: "id", nullable: true },
      { name: "assignee_id", arg: "p_assignee_id", kind: "uuid", nullable: true },
      { name: "scheduled_date", arg: "p_scheduled_date", kind: "date", nullable: true },
      { name: "time_from", arg: "p_time_from", kind: "time", nullable: true },
      { name: "time_to", arg: "p_time_to", kind: "time", nullable: true },
    ],
    objectIdOf: writeId,
  },
  {
    operationId: "assignTask",
    method: "POST",
    path: "/v1/tasks/{id}/assign",
    scope: "tasks:assign",
    fn: "api_v1_assign_task",
    kind: "write",
    params: [PATH_UUID("p_task_id")],
    body: [
      { name: "assignee_id", arg: "p_assignee_id", kind: "uuid", required: true },
      { name: "scheduled_date", arg: "p_scheduled_date", kind: "date", nullable: true },
      { name: "time_from", arg: "p_time_from", kind: "time", nullable: true },
      { name: "time_to", arg: "p_time_to", kind: "time", nullable: true },
    ],
    objectIdOf: writeId,
  },
  {
    operationId: "listTaskMedia",
    method: "GET",
    path: "/v1/tasks/{id}/media",
    scope: "media:read",
    fn: "api_v1_list_task_media",
    kind: "list",
    params: [PATH_UUID("p_task_id")],
  },
  {
    operationId: "listStaff",
    method: "GET",
    path: "/v1/staff",
    scope: "staff:read",
    fn: "api_v1_list_staff",
    kind: "list",
    params: [
      { name: "role", arg: "p_role", kind: "text", list: true, enum: STAFF_ROLE },
      { name: "active", arg: "p_active", kind: "boolean" },
    ],
    cursor: byId("uuid"),
  },
  {
    operationId: "getStaffMember",
    method: "GET",
    path: "/v1/staff/{id}",
    scope: "staff:read",
    fn: "api_v1_get_staff_member",
    kind: "item",
    params: [PATH_UUID("p_id")],
  },
  {
    operationId: "listBookings",
    method: "GET",
    path: "/v1/bookings",
    scope: "bookings:read",
    fn: "api_v1_list_bookings",
    kind: "list",
    params: [
      { name: "date_from", arg: "p_date_from", kind: "date" },
      { name: "date_to", arg: "p_date_to", kind: "date" },
      { name: "property_id", arg: "p_property_id", kind: "id" },
      { name: "channel", arg: "p_channel", kind: "text", list: true, enum: CHANNEL },
      { name: "status", arg: "p_status", kind: "text", list: true },
      UPDATED_SINCE,
    ],
    cursor: byField("arrival_date", "p_after_date", "date", "id"),
  },
  {
    operationId: "getBooking",
    method: "GET",
    path: "/v1/bookings/{id}",
    scope: "bookings:read",
    fn: "api_v1_get_booking",
    kind: "item",
    params: [PATH_ID("p_id")],
  },
  {
    operationId: "getSettings",
    method: "GET",
    path: "/v1/settings",
    scope: "settings:read",
    fn: "api_v1_get_settings",
    kind: "item",
    params: [],
  },
];

export interface RouteMatch {
  readonly route: Route;
  readonly pathValues: Readonly<Record<string, string>>;
}

function segmentsOf(path: string): string[] {
  return path.split("/").filter((segment) => segment !== "");
}

/** The route for a path, and the methods the path takes (for 405). */
export function matchRoute(method: string, path: string): { match: RouteMatch | null; allowed: string[] } {
  const actual = segmentsOf(path);
  const allowed: string[] = [];
  let match: RouteMatch | null = null;
  for (const route of ROUTES) {
    const template = segmentsOf(route.path);
    if (template.length !== actual.length) {
      continue;
    }
    const values: Record<string, string> = {};
    const fits = template.every((segment, i) => {
      if (segment.startsWith("{") && segment.endsWith("}")) {
        values[segment.slice(1, -1)] = decodeURIComponent(actual[i]);
        return actual[i] !== "";
      }
      return segment === actual[i];
    });
    if (!fits) {
      continue;
    }
    allowed.push(route.method);
    if (route.method === method) {
      match = { route, pathValues: values };
    }
  }
  return { match, allowed };
}
