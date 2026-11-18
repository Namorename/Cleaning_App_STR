'use client';

import { BOARD_LIMITS, isCardColor, type CardColor } from '@str-ops/shared';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { propertyOptions } from '@/features/tasks/schema';
import { useProperties } from '@/features/tasks/use-tasks';

import type { CardFields } from './api';
import { ColorPicker } from './color-picker';
import type { BoardCard } from './schema';

/** A card's fields as the form holds them: an empty due date is `''`, as a date input has it. */
export interface FieldsDraft {
  title: string;
  description: string;
  dueOn: string;
  propertyId: number | null;
  color: CardColor | null;
}

export const EMPTY_FIELDS: FieldsDraft = {
  title: '',
  description: '',
  dueOn: '',
  propertyId: null,
  color: null,
};

export function draftOf(card: BoardCard): FieldsDraft {
  return {
    title: card.title,
    description: card.description,
    dueOn: card.due_on ?? '',
    propertyId: card.property_id,
    color: isCardColor(card.color) ? card.color : null,
  };
}

export function fieldsOf(draft: FieldsDraft): CardFields {
  return {
    title: draft.title.trim(),
    description: draft.description,
    dueOn: draft.dueOn === '' ? null : draft.dueOn,
    propertyId: draft.propertyId,
    color: draft.color,
  };
}

/** The select's value for «Без объекта»; a listing is its id. */
const NO_PLACE = 'none';

interface CardFieldsFormProps {
  draft: FieldsDraft;
  onChange: (next: FieldsDraft) => void;
  /** Ties the labels to their fields; one per form on the page. */
  idPrefix: string;
  /**
   * The place the card has now, by its name: kept in the list even when the place is no
   * longer offered (archived), so it shows and can be taken away.
   */
  currentPlace?: { id: number; name: string } | null;
}

/**
 * The fields of a card: the title, the description (its links open from the
 * card), the due date, the place and the colour. Shared by the new card's form
 * and the card's own «Изменить».
 */
export function CardFieldsForm({
  draft,
  onChange,
  idPrefix,
  currentPlace = null,
}: CardFieldsFormProps) {
  const { t } = useTranslation();
  const properties = useProperties();
  // Sorted and composed once per list, not once per keystroke.
  const places = useMemo(() => {
    const offered = propertyOptions(properties.data ?? []);
    return currentPlace === null || offered.some((place) => place.id === currentPlace.id)
      ? offered
      : [currentPlace, ...offered];
  }, [properties.data, currentPlace]);
  const id = (field: string) => `${idPrefix}-${field}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor={id('title')}>{t('boards.cardTitle')}</Label>
        <Input
          id={id('title')}
          value={draft.title}
          maxLength={BOARD_LIMITS.cardTitle}
          onChange={(event) => onChange({ ...draft, title: event.target.value })}
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor={id('description')}>{t('boards.description')}</Label>
        <Textarea
          id={id('description')}
          rows={4}
          value={draft.description}
          maxLength={BOARD_LIMITS.description}
          placeholder={t('boards.descriptionPlaceholder')}
          onChange={(event) => onChange({ ...draft, description: event.target.value })}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={id('due')}>{t('boards.due')}</Label>
          <div className="flex items-center gap-2">
            <Input
              id={id('due')}
              type="date"
              value={draft.dueOn}
              onChange={(event) => onChange({ ...draft, dueOn: event.target.value })}
              className="h-11"
            />
            {draft.dueOn === '' ? null : (
              <Button
                type="button"
                variant="ghost"
                className="h-11 shrink-0"
                onClick={() => onChange({ ...draft, dueOn: '' })}
              >
                {t('boards.clearDue')}
              </Button>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={id('place')}>{t('boards.property')}</Label>
          <NativeSelect
            id={id('place')}
            value={draft.propertyId === null ? NO_PLACE : String(draft.propertyId)}
            className="h-11"
            onChange={(event) =>
              onChange({
                ...draft,
                propertyId: event.target.value === NO_PLACE ? null : Number(event.target.value),
              })
            }
          >
            <option value={NO_PLACE}>{t('boards.noProperty')}</option>
            {places.map((place) => (
              <option key={place.id} value={place.id}>
                {place.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t('boards.color')}</span>
        <ColorPicker
          label={t('boards.color')}
          value={draft.color}
          onChange={(color) => onChange({ ...draft, color })}
        />
      </div>
    </div>
  );
}
