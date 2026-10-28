import type { Preset } from '@str-ops/shared/src/api/registry';
import { z } from 'zod';

/** What list_api_keys / update_api_key / revoke_api_key answer for a key. Never its digest. */
export const apiKeySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    prefix: z.string(),
    preset: z.enum(['read_only', 'operator', 'full', 'custom']),
    scopes: z.array(z.string()),
    effective_scopes: z.array(z.string()),
    property_ids: z.array(z.number()).nullable(),
    expires_at: z.string().nullable(),
    state: z.enum(['active', 'expired', 'revoked', 'suspended', 'invalid']),
    created_by: z.string(),
    created_at: z.string(),
    last_used_at: z.string().nullable(),
    revoked_at: z.string().nullable(),
  })
  .transform((row) => ({
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    preset: row.preset as Preset,
    scopes: row.scopes,
    effectiveScopes: row.effective_scopes,
    propertyIds: row.property_ids,
    expiresAt: row.expires_at,
    state: row.state,
    createdBy: row.created_by,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  }));
export type ApiKey = z.output<typeof apiKeySchema>;
export const apiKeyListSchema = z.array(apiKeySchema);

/** What api-keys answers on success: the key itself, shown once, and the stored row. */
export const createdKeySchema = z.object({
  key: z.string().regex(/^woom_[A-Za-z0-9_-]{43}$/),
  api_key: apiKeySchema,
});
export type CreatedKey = z.output<typeof createdKeySchema>;

/** The expiries offered: days from now, or never. */
export const EXPIRY_CHOICES = [30, 90, 365, null] as const;
export type ExpiryChoice = (typeof EXPIRY_CHOICES)[number];

/** The form, for a new key and for a change alike (expiry only on a new one). */
export interface KeyDraft {
  name: string;
  preset: Preset;
  /** For custom: the whole set. For a preset: the sensitive scopes added by hand. */
  scopes: string[];
  restrict: boolean;
  propertyIds: number[];
  expiresInDays: ExpiryChoice;
  /** The key's name typed again: asked for full access. */
  confirmation: string;
}

export const EMPTY_DRAFT: KeyDraft = {
  name: '',
  preset: 'read_only',
  scopes: [],
  restrict: false,
  propertyIds: [],
  expiresInDays: 90,
  confirmation: '',
};

/** The form opened on an existing key. */
export function draftOf(key: ApiKey): KeyDraft {
  return {
    name: key.name,
    preset: key.preset,
    scopes: key.scopes,
    restrict: key.propertyIds !== null,
    propertyIds: key.propertyIds ?? [],
    expiresInDays: null,
    confirmation: '',
  };
}
