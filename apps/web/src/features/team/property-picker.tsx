'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Input } from '@/components/ui/input';

import type { Property } from './schema';

interface PropertyPickerProps {
  properties: readonly Property[];
  /** The listings currently ticked, by id. */
  selected: readonly number[];
  isPending: boolean;
  onChange: (next: number[]) => void;
}

/**
 * Which listings are open to one person.
 *
 * A tick list rather than the editor in the drawer: at this point the question
 * is only "which ones", and the terms — who is fixed to a listing, who waits
 * in its queue — are a second question that would make the form long enough to
 * scroll past the name field. A listing ticked here is added to the queue; the
 * drawer is where it gets promoted.
 *
 * The list carries the company's whole catalogue, so it scrolls rather than
 * pushing the buttons off the screen, and a search narrows it: past a dozen
 * flats the scroll is slower than typing the street.
 *
 * The search hides rows, it never unticks them. A listing ticked and then
 * filtered out of sight is still going to be opened, and the count under the
 * list keeps saying so — it counts what is chosen, not what is visible.
 */
export function PropertyPicker({ properties, selected, isPending, onChange }: PropertyPickerProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  const needle = query.trim().toLowerCase();
  const shown =
    needle === ''
      ? properties
      : properties.filter((property) => property.name.toLowerCase().includes(needle));

  const toggle = (id: number, isOn: boolean) => {
    onChange(isOn ? [...selected, id] : selected.filter((current) => current !== id));
  };

  if (isPending) {
    return <p className="text-sm text-muted-foreground">{t('panel.team.loading')}</p>;
  }

  if (properties.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('panel.team.form.propertiesEmpty')}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <Input
        type="search"
        value={query}
        placeholder={t('panel.team.form.propertiesSearch')}
        aria-label={t('panel.team.form.propertiesSearch')}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border p-2">
        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('panel.team.form.propertiesNoMatch')}
          </p>
        ) : (
          shown.map((property) => (
            <label key={property.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={selected.includes(property.id)}
                onChange={(event) => toggle(property.id, event.target.checked)}
              />
              {property.name}
            </label>
          ))
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {t('panel.team.form.propertiesChosen', { total: selected.length })}
      </p>
    </div>
  );
}
