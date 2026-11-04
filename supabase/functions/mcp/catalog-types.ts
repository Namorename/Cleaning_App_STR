/**
 * The shape of catalog.ts, the MCP server's tools (docs/mcp-server.md §3).
 *
 * The same shape as packages/shared/src/api/mcp-tools.ts builds: an Edge
 * Function cannot import from packages/, so the types are written twice, and
 * the catalog the build writes type-checks against these.
 */

export type McpToolKind = "read" | "write";
export type McpArgPlace = "path" | "query" | "header" | "body";

/** One input of a tool, and where the API takes it. */
export interface McpToolArg {
  readonly name: string;
  readonly place: McpArgPlace;
  /** The name on the wire: path or query parameter, header, body field. */
  readonly wire: string;
}

export interface McpToolAnnotations {
  readonly title: string;
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
  readonly idempotentHint: boolean;
  readonly openWorldHint: boolean;
}

export interface McpTool {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly annotations: McpToolAnnotations;
  readonly operationId: string;
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly scope: string | null;
  readonly kind: McpToolKind;
  readonly paged: boolean;
  readonly args: readonly McpToolArg[];
}

export interface McpCatalog {
  readonly version: 1;
  readonly defaultLimit: number;
  readonly maxLimit: number;
  readonly tools: readonly McpTool[];
}
