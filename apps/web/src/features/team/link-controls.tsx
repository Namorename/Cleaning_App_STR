'use client';

import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';

import { ASSIGNMENT_MODES, MAX_PRIORITY, MIN_PRIORITY, type AssignmentMode } from './schema';

/**
 * The controls of one link — a person on a listing — shared by the two ends
 * that edit it: «Команда» lists a person's listings, the property card's
 * «Клинеры» a listing's people. Each names the other end in its labels.
 */

interface LinkTermsProps {
  /** The other end of the link, as the labels name it: the listing, or the person. */
  name: string;
  mode: AssignmentMode;
  priority: number;
  /**
   * False for somebody who is not put on listings — a technician with a link
   * from before the rule, a cleaner since made a manager: the server refuses
   * any change of the terms (20261003110000), so the mode is only said.
   */
  isEditable: boolean;
  /** The terms as the manager just set them: the mode and the place in the queue. */
  onChange: (mode: AssignmentMode, priority: number) => void;
}

/** How a listing reaches this person, and the place in its queue — each written as it changes. */
export function LinkTerms({ name, mode, priority, isEditable, onChange }: LinkTermsProps) {
  const { t } = useTranslation();

  if (!isEditable) {
    return (
      <span className="text-xs text-muted-foreground">{t(`panel.team.links.modes.${mode}`)}</span>
    );
  }

  return (
    <>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t('panel.team.links.mode')}
        <NativeSelect
          aria-label={t('panel.team.links.modeFor', { name })}
          value={mode}
          onChange={(event) => onChange(event.target.value as AssignmentMode, priority)}
        >
          {ASSIGNMENT_MODES.map((option) => (
            <option key={option} value={option}>
              {t(`panel.team.links.modes.${option}`)}
            </option>
          ))}
        </NativeSelect>
      </label>

      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t('panel.team.links.priority')}
        <Input
          type="number"
          className="w-20"
          aria-label={t('panel.team.links.priorityFor', { name })}
          min={MIN_PRIORITY}
          max={MAX_PRIORITY}
          defaultValue={priority}
          onBlur={(event) => {
            const next = Number(event.target.value);
            if (next === priority || Number.isNaN(next)) {
              return;
            }
            onChange(mode, next);
          }}
        />
      </label>
    </>
  );
}

interface RemoveLinkButtonProps {
  /** The other end of the link, which the button's name says it takes off. */
  name: string;
  onRemove: () => void;
}

/**
 * «Убрать», named after what it takes off: a list of rows that each say only
 * «Убрать» reads to a screen reader as one word over and over. A 48 px target
 * (design decision 5) — for a technician's old link it is the row's one action.
 */
export function RemoveLinkButton({ name, onRemove }: RemoveLinkButtonProps) {
  const { t } = useTranslation();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="min-h-12"
      aria-label={t('panel.team.links.removeFor', { name })}
      onClick={onRemove}
    >
      {t('panel.team.links.remove')}
    </Button>
  );
}
