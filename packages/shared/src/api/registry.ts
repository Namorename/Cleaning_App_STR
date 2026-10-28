/**
 * The API scope registry, typed (docs/api-v1.md §3).
 *
 * registry.json is the one list of scopes. The panel builds its key form from
 * it, build-spec.ts writes the documentation's tables from it, and the parity
 * test holds the database's copy (the api-scopes blocks of the migrations)
 * and the spec's x-woom-scope marks to it.
 *
 * Pure on purpose — no JSON import here — so that a Node script can load it
 * with --experimental-strip-types; the data itself is registry-data.ts.
 *
 * effectiveScopes() repeats public.api_effective_scopes(), the rule the
 * database applies at every request, so the panel can show what a preset gives
 * before the key exists; a test compares the two rules case by case.
 */

export type ScopeAction = 'read' | 'write';
export type ScopeSensitivity = 'normal' | 'sensitive';
export type ScopeStatus = 'exposed' | 'planned';
export type Preset = 'read_only' | 'operator' | 'full' | 'custom';

export interface ScopeEntry {
  readonly id: string;
  readonly group: string;
  readonly action: ScopeAction;
  readonly sensitivity: ScopeSensitivity;
  readonly status: ScopeStatus;
  readonly operator: boolean;
}

export interface ForbiddenEntry {
  readonly id: string;
  readonly reason: string;
}

export interface ApiRegistry {
  readonly version: number;
  readonly groups: readonly string[];
  readonly presets: readonly Preset[];
  readonly scopes: readonly ScopeEntry[];
  readonly forbidden: readonly ForbiddenEntry[];
}

/** Scopes a key may hold today, in registry order. */
export function exposedScopes(registry: ApiRegistry): readonly ScopeEntry[] {
  return registry.scopes.filter((scope) => scope.status === 'exposed');
}

/**
 * What a key with this preset and these hand-picked scopes may do. The same
 * rule as public.api_effective_scopes(): read only is every ordinary read,
 * operator adds the scopes marked `operator`, full is everything exposed, and
 * the scopes stored on the key are added to any of them.
 */
export function effectiveScopes(
  preset: Preset,
  picked: readonly string[],
  registry: ApiRegistry,
): string[] {
  return exposedScopes(registry)
    .filter((scope) => {
      if (preset === 'full' || picked.includes(scope.id)) {
        return true;
      }
      const ordinaryRead = scope.action === 'read' && scope.sensitivity === 'normal';
      if ((preset === 'read_only' || preset === 'operator') && ordinaryRead) {
        return true;
      }
      return preset === 'operator' && scope.operator;
    })
    .map((scope) => scope.id)
    .sort();
}

/** The i18n key of a scope's label: `settings.api.scopes.<group>.<action>`. */
export function scopeLabelKey(id: string): string {
  const [group, action] = id.split(':');
  return `settings.api.scopes.${group}.${action}`;
}
