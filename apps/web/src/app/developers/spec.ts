import openapi from '@str-ops/shared/src/api/openapi.v1.json';

/** Where the API answers under a Supabase project: the `api` Edge Function. */
export const API_FUNCTION_PATH = '/functions/v1/api';

export interface OpenApiServer {
  readonly url: string;
  readonly description?: string;
}

/** The parts of the OpenAPI document this page touches; the rest passes through as is. */
export interface OpenApiDocument {
  readonly openapi: string;
  readonly servers: readonly OpenApiServer[];
  readonly paths: Readonly<Record<string, unknown>>;
  readonly [key: string]: unknown;
}

/** The API's base address for the project the panel runs against. */
export function apiServerUrl(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}${API_FUNCTION_PATH}`;
}

/**
 * The committed spec as a reader of this deployment needs it: the servers of
 * the file (a `{project_ref}` template and a local stand) give way to the one
 * address this panel's project answers at, so "Test request" and the
 * downloaded file both point at the real API. A new object every call: the
 * imported module stays as committed.
 */
export function publicSpec(supabaseUrl: string): OpenApiDocument {
  return {
    ...openapi,
    servers: [{ url: apiServerUrl(supabaseUrl), description: 'woom API' }],
  };
}
