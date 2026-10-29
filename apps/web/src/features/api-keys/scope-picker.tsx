'use client';

import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  effectiveScopes,
  exposedScopes,
  scopeLabelKey,
  type Preset,
  type ScopeEntry,
} from '@str-ops/shared/src/api/registry';
import { API_REGISTRY } from '@str-ops/shared/src/api/registry-data';

import { EmptyState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { matchesAllTokens } from '@/lib/search';

export interface ScopeChoice {
  preset: Preset;
  /** For custom: the whole set. For a preset: the sensitive scopes added by hand. */
  scopes: string[];
}

interface ScopePickerProps {
  value: ScopeChoice;
  onChange: (next: ScopeChoice) => void;
}

const PRESETS: readonly Preset[] = API_REGISTRY.presets;

/** A scope a preset gives by its rule, before anything is ticked by hand. */
function givenByPreset(preset: Preset, scope: ScopeEntry): boolean {
  return preset !== 'custom' && effectiveScopes(preset, [], API_REGISTRY).includes(scope.id);
}

/**
 * Which scopes a key holds: a preset, or ticks by group.
 *
 * The registry (packages/shared/src/api/registry.json) is the list; the rule
 * that turns a preset into scopes is the database's, repeated in
 * effectiveScopes() so the summary under the list says what the key will be
 * able to do before it exists.
 *
 * With Read only or Operator, the scopes the preset gives are ticked and
 * fixed, and only sensitive ones can be added by hand — a writing scope added
 * to «Read only» would make the name a lie; that is what Custom is for. Full
 * access ticks everything. Switching to Custom starts from what the preset
 * gave, so nothing is lost by the switch.
 *
 * The search hides rows, it never unticks them.
 */
export function ScopePicker({ value, onChange }: ScopePickerProps) {
  const { t } = useTranslation();
  const baseId = useId();
  const [query, setQuery] = useState('');

  const effective = effectiveScopes(value.preset, value.scopes, API_REGISTRY);
  const exposed = exposedScopes(API_REGISTRY);

  const choosePreset = (preset: Preset) => {
    if (preset === value.preset) {
      return;
    }
    if (preset === 'custom') {
      onChange({ preset, scopes: effective });
      return;
    }
    const sensitive = new Set(exposed.filter((s) => s.sensitivity === 'sensitive').map((s) => s.id));
    onChange({ preset, scopes: preset === 'full' ? [] : value.scopes.filter((id) => sensitive.has(id)) });
  };

  const toggle = (id: string, isOn: boolean) => {
    const next = isOn ? [...value.scopes, id] : value.scopes.filter((current) => current !== id);
    onChange({ preset: value.preset, scopes: [...new Set(next)].sort() });
  };

  const textOf = (scope: ScopeEntry) =>
    `${t(`${scopeLabelKey(scope.id)}.label`)} ${t(`${scopeLabelKey(scope.id)}.hint`)} ${scope.id}`;
  const shown = exposed.filter((scope) => matchesAllTokens(textOf(scope), query));

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{t('panel.settings.api.form.preset')}</legend>
        {PRESETS.map((preset) => {
          const id = `${baseId}-preset-${preset}`;
          return (
            <div key={preset} className="flex items-start gap-2">
              <input
                id={id}
                type="radio"
                name={`${baseId}-preset`}
                className="mt-1 size-4"
                checked={value.preset === preset}
                aria-describedby={`${id}-hint`}
                onChange={() => choosePreset(preset)}
              />
              <div className="flex flex-col">
                <label htmlFor={id} className="text-sm font-medium">
                  {t(`panel.settings.api.form.presets.${preset}.label`)}
                </label>
                <p id={`${id}-hint`} className="text-xs text-muted-foreground">
                  {t(`panel.settings.api.form.presets.${preset}.hint`)}
                </p>
              </div>
            </div>
          );
        })}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">
          {value.preset === 'custom' || value.preset === 'full'
            ? t('panel.settings.api.form.scopesTitle')
            : t('panel.settings.api.form.extraTitle')}
        </legend>
        <p className="text-xs text-muted-foreground">{t('panel.settings.api.form.sensitiveHint')}</p>
        <Input
          type="search"
          value={query}
          placeholder={t('panel.settings.api.form.search')}
          aria-label={t('panel.settings.api.form.search')}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
            }
          }}
        />
        <div className="flex max-h-72 flex-col gap-3 overflow-y-auto rounded-md border p-2">
          {shown.length === 0 ? (
            <EmptyState>{t('panel.settings.api.form.noMatch')}</EmptyState>
          ) : (
            API_REGISTRY.groups
              .map((group) => ({ group, scopes: shown.filter((scope) => scope.group === group) }))
              .filter(({ scopes }) => scopes.length > 0)
              .map(({ group, scopes }) => (
                <div key={group} role="group" aria-labelledby={`${baseId}-group-${group}`} className="flex flex-col gap-1">
                  <p id={`${baseId}-group-${group}`} className="text-xs font-semibold uppercase text-muted-foreground">
                    {t(`panel.settings.api.groups.${group}`)}
                  </p>
                  {scopes.map((scope) => {
                    const id = `${baseId}-scope-${scope.id.replace(':', '-')}`;
                    const isGiven = value.preset === 'full' || givenByPreset(value.preset, scope);
                    const isOpen =
                      value.preset === 'custom' ||
                      (!isGiven && value.preset !== 'full' && scope.sensitivity === 'sensitive');
                    return (
                      <div key={scope.id} className="flex items-start gap-2">
                        <input
                          id={id}
                          type="checkbox"
                          className="mt-1 size-4"
                          checked={effective.includes(scope.id)}
                          disabled={!isOpen}
                          aria-describedby={`${id}-hint`}
                          onChange={(event) => toggle(scope.id, event.target.checked)}
                        />
                        <div className="flex min-w-0 flex-col">
                          <div className="flex flex-wrap items-center gap-2">
                            <label htmlFor={id} className="text-sm">
                              {t(`${scopeLabelKey(scope.id)}.label`)}
                            </label>
                            <code className="text-xs text-muted-foreground">{scope.id}</code>
                            {scope.sensitivity === 'sensitive' ? (
                              <Badge variant="destructive">{t('panel.settings.api.form.sensitive')}</Badge>
                            ) : null}
                          </div>
                          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
                            {t(`${scopeLabelKey(scope.id)}.hint`)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))
          )}
        </div>
      </fieldset>

      <div role="status" className="flex flex-col gap-1 text-sm">
        {effective.length === 0 ? (
          <p className="text-destructive">{t('panel.settings.api.form.givesNothing')}</p>
        ) : (
          <>
            <p className="font-medium">{t('panel.settings.api.form.gives')}</p>
            <ul className="list-disc pl-5 text-muted-foreground">
              {effective.map((id) => (
                <li key={id}>{t(`${scopeLabelKey(id)}.label`)}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
