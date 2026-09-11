'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Person } from '@/components/person';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ASSIGNMENT_MODES,
  canHaveLinks,
  MAX_PRIORITY,
  MIN_PRIORITY,
  type AssignmentMode,
  type Staff,
} from '@/features/team/schema';
import {
  useCleanerLinks,
  useRemoveCleanerLink,
  useSaveCleanerLink,
  useStaff,
} from '@/features/team/use-team';
import { serverErrorText } from '@/lib/server-error';

const SELECT_CLASS = 'h-9 rounded-md border bg-background px-2 text-sm';

interface CleanersTabProps {
  propertyId: number;
}

/**
 * Who works this flat, and on what terms.
 *
 * The same link the Team section edits from the other end — a person and a
 * listing — so it goes through the same hooks rather than a second copy of
 * them. Read from here it answers a different question: Team asks "what does
 * she work", this asks "who works it", and a flat with nobody on it is a flat
 * whose cleanings sit in the pool until somebody notices.
 *
 * Only cleaners and technicians are on offer. A manager in this list would
 * turn up in a schedule, which is not what putting her in the company meant.
 */
export function CleanersTab({ propertyId }: CleanersTabProps) {
  const { t } = useTranslation();
  const staff = useStaff();
  const links = useCleanerLinks();
  const save = useSaveCleanerLink();
  const remove = useRemoveCleanerLink();
  const [adding, setAdding] = useState('');

  const everybody = staff.data ?? [];
  const allLinks = links.data ?? [];
  const here = allLinks.filter((link) => link.property_id === propertyId);
  const byId = new Map(everybody.map((person) => [person.id, person]));

  // Automatic first — that person gets the work whether she looks or not —
  // then the queue by position, and names break a tie so nothing shuffles.
  const rows = [...here].sort((left, right) => {
    if (left.mode !== right.mode) {
      return left.mode === 'auto' ? -1 : 1;
    }
    const byPriority = left.priority - right.priority;
    if (byPriority !== 0) {
      return byPriority;
    }
    return (byId.get(left.cleaner_id)?.full_name ?? '').localeCompare(
      byId.get(right.cleaner_id)?.full_name ?? '',
    );
  });

  const taken = new Set(here.map((link) => link.cleaner_id));
  const available = everybody.filter(
    (person) => canHaveLinks(person) && person.is_active && !taken.has(person.id),
  );

  const failure = save.isError
    ? serverErrorText(save.error)
    : remove.isError
      ? serverErrorText(remove.error)
      : null;

  const add = () => {
    if (adding === '') {
      return;
    }
    save.mutate(
      { propertyId, cleanerId: adding, mode: 'claim', priority: MIN_PRIORITY },
      { onSuccess: () => setAdding('') },
    );
  };

  const nameOf = (person: Staff | undefined) => person?.full_name ?? person?.email ?? '—';

  if (staff.isPending || links.isPending) {
    return <p className="text-sm text-muted-foreground">{t('panel.apartments.loading')}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('panel.apartments.cleaners.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((link) => {
            const person = byId.get(link.cleaner_id);
            const name = nameOf(person);
            return (
              <li
                key={link.cleaner_id}
                className="flex flex-wrap items-end gap-2 rounded-md border p-2"
              >
                <span className="min-w-40 flex-1 text-sm">
                  <Person name={name} role={person?.role} />
                </span>

                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  {t('panel.team.links.mode')}
                  <select
                    className={SELECT_CLASS}
                    aria-label={t('panel.team.links.modeFor', { name })}
                    value={link.mode}
                    onChange={(event) =>
                      save.mutate({
                        propertyId,
                        cleanerId: link.cleaner_id,
                        mode: event.target.value as AssignmentMode,
                        priority: link.priority,
                      })
                    }
                  >
                    {ASSIGNMENT_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {t(`panel.team.links.modes.${mode}`)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  {t('panel.team.links.priority')}
                  <Input
                    type="number"
                    className="w-20"
                    aria-label={t('panel.team.links.priorityFor', { name })}
                    min={MIN_PRIORITY}
                    max={MAX_PRIORITY}
                    defaultValue={link.priority}
                    onBlur={(event) => {
                      const next = Number(event.target.value);
                      if (next === link.priority || Number.isNaN(next)) {
                        return;
                      }
                      save.mutate({
                        propertyId,
                        cleanerId: link.cleaner_id,
                        mode: link.mode,
                        priority: next,
                      });
                    }}
                  />
                </label>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => remove.mutate({ propertyId, cleanerId: link.cleaner_id })}
                >
                  {t('panel.team.links.remove')}
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-2 border-t pt-3">
        <label className="flex flex-1 flex-col gap-1 text-xs text-muted-foreground">
          {t('panel.apartments.cleaners.add')}
          <select
            className={SELECT_CLASS}
            value={adding}
            onChange={(event) => setAdding(event.target.value)}
          >
            <option value="">{t('panel.apartments.cleaners.addPlaceholder')}</option>
            {available.map((person) => (
              <option key={person.id} value={person.id}>
                {nameOf(person)}
              </option>
            ))}
          </select>
        </label>
        <Button type="button" disabled={adding === '' || save.isPending} onClick={add}>
          {t('panel.team.links.addButton')}
        </Button>
      </div>

      {failure === null ? null : (
        <div role="alert" className="flex flex-col gap-1">
          <p className="text-sm text-destructive">{failure.text}</p>
          {failure.detail === null ? null : (
            <p className="text-xs text-muted-foreground">{failure.detail}</p>
          )}
        </div>
      )}
    </div>
  );
}
