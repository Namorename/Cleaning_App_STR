'use client';

import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { NativeSelect } from '@/components/ui/native-select';
import { PropertyPicker } from '@/features/team/property-picker';

import { buildingsOf, placeIndex, placeLabel } from './places';
import { KB_SCOPES, type KbScope, type Place } from './schema';

// A building's article names one listing (save_kb_article); the server says so
// if more places are left from «Выбранные объекты».

interface PlacementFieldProps {
  scope: KbScope;
  propertyIds: readonly number[];
  places: readonly Place[];
  isPlacesPending: boolean;
  onChange: (next: { scope: KbScope; propertyIds: number[] }) => void;
}

/**
 * Where an article shows (the owner's decision 2 of 2026-10-17): the whole
 * company, one building — its rooms with it — or places chosen one by one.
 *
 * A place the writer does not see stays as it is: the head technician reads
 * the places of his tasks only, and an article a manager placed elsewhere
 * keeps those places through his edit.
 */
export function PlacementField({
  scope,
  propertyIds,
  places,
  isPlacesPending,
  onChange,
}: PlacementFieldProps) {
  const { t } = useTranslation();
  const baseId = useId();
  const index = placeIndex(places);
  const hidden = propertyIds.filter((id) => !index.byId.has(id));
  const shown = propertyIds.filter((id) => index.byId.has(id));
  const buildings = buildingsOf(places).filter(
    (building) => building.status !== 'archived' || propertyIds.includes(building.id),
  );
  const choices = places
    .filter((place) => place.status !== 'archived' || propertyIds.includes(place.id))
    .map((place) => ({ id: place.id, name: placeLabel(index, place.id) ?? place.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // The places stay through a change of mind: «Вся компания» sends none
  // (api.ts), and a place out of the writer's sight is never dropped by a click.
  const setScope = (next: KbScope) => onChange({ scope: next, propertyIds: [...propertyIds] });
  const chosenBuilding = buildings.find((building) => shown.includes(building.id));

  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">{t('panel.knowledge.editor.placement')}</legend>

      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {KB_SCOPES.map((option) => (
          <label key={option} className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="radio"
              name={`${baseId}-scope`}
              value={option}
              className="size-4"
              checked={scope === option}
              onChange={() => setScope(option)}
            />
            {t(`panel.knowledge.editor.scope.${option}`)}
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {t(`panel.knowledge.editor.scopeHint.${scope}`)}
      </p>

      {scope === 'building' ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${baseId}-building`} className="text-sm font-medium">
            {t('panel.knowledge.editor.building')}
          </label>
          {buildings.length === 0 && !isPlacesPending ? (
            <p className="text-sm text-muted-foreground">
              {t('panel.knowledge.editor.noBuildings')}
            </p>
          ) : (
            <NativeSelect
              id={`${baseId}-building`}
              value={chosenBuilding === undefined ? '' : String(chosenBuilding.id)}
              className="sm:w-80"
              onChange={(event) =>
                onChange({
                  scope,
                  propertyIds: event.target.value === '' ? [] : [Number(event.target.value)],
                })
              }
            >
              <option value="">{t('panel.knowledge.editor.chooseBuilding')}</option>
              {buildings.map((building) => (
                <option key={building.id} value={building.id}>
                  {building.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </div>
      ) : null}

      {scope === 'properties' ? (
        <PropertyPicker
          properties={choices}
          selected={shown}
          isPending={isPlacesPending}
          onChange={(next) => onChange({ scope, propertyIds: [...next, ...hidden] })}
        />
      ) : null}

      {scope !== 'company' && hidden.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('panel.knowledge.editor.hiddenPlaces', { count: hidden.length })}
        </p>
      ) : null}
    </fieldset>
  );
}
