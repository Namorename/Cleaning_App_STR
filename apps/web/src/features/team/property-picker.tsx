'use client';

import { useTranslation } from 'react-i18next';

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
 * pushing the buttons off the screen.
 */
export function PropertyPicker({ properties, selected, isPending, onChange }: PropertyPickerProps) {
  const { t } = useTranslation();

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
      <div className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border p-2">
        {properties.map((property) => (
          <label key={property.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={selected.includes(property.id)}
              onChange={(event) => toggle(property.id, event.target.checked)}
            />
            {property.name}
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {t('panel.team.form.propertiesChosen', { total: selected.length })}
      </p>
    </div>
  );
}
