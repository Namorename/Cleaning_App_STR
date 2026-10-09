'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Person } from '@/components/person';
import { EmptyState, LoadingState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { LinkTerms, RemoveLinkButton } from '@/features/team/link-controls';
import { canHaveLinks, MIN_PRIORITY, type Staff } from '@/features/team/schema';
import {
  useCleanerLinks,
  useRemoveCleanerLink,
  useSaveCleanerLink,
  useStaff,
} from '@/features/team/use-team';
import { serverErrorText } from '@/lib/server-error';

import { ListingLink } from './listing-link';
import type { ListingRef } from './schema';

interface CleanersTabProps {
  propertyId: number;
  /**
   * Set on a room: its cleaners are its listing's, shown and never written
   * here — a room's own `auto` link would beat the listing's in the generator,
   * and the screen does not create one (20260912140000; plan 7.1, trap 5).
   */
  listing?: ListingRef | null;
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
 * Only cleaners are on offer. A manager in this list would turn up in a
 * schedule, which is not what putting her in the company meant; a technician
 * or a head technician is refused by the server (techNotLinkable,
 * 20261003110000) — cleanings are not their work. One who still holds a link
 * from before that rule is listed with its mode, and the link can only be
 * taken off, as in «Команда».
 */
export function CleanersTab({ propertyId, listing = null }: CleanersTabProps) {
  const { t } = useTranslation();
  const staff = useStaff();
  const links = useCleanerLinks();
  const save = useSaveCleanerLink();
  const remove = useRemoveCleanerLink();
  const [adding, setAdding] = useState('');

  const everybody = staff.data ?? [];
  const allLinks = links.data ?? [];
  const here = allLinks.filter((link) => link.property_id === (listing?.id ?? propertyId));
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
    return <LoadingState>{t('panel.apartments.loading')}</LoadingState>;
  }

  if (listing !== null) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm">
          {t('panel.apartments.room.cleaners')}{' '}
          <ListingLink className="underline" id={listing.id}>
            {listing.name}
          </ListingLink>
        </p>
        {rows.length === 0 ? (
          <EmptyState>{t('panel.apartments.cleaners.empty')}</EmptyState>
        ) : (
          <ul className="flex flex-col gap-1">
            {rows.map((link) => (
              <li key={link.cleaner_id} className="text-sm">
                {nameOf(byId.get(link.cleaner_id))} · {t(`panel.team.links.modes.${link.mode}`)}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {rows.length === 0 ? (
        <EmptyState>{t('panel.apartments.cleaners.empty')}</EmptyState>
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

                {/* A technician's link from before the rule: its terms are not
                    changed — the server would refuse it — only taken off. A
                    person the list does not know is not offered a change either. */}
                <LinkTerms
                  name={name}
                  mode={link.mode}
                  priority={link.priority}
                  isEditable={person !== undefined && canHaveLinks(person)}
                  onChange={(mode, priority) =>
                    save.mutate({ propertyId, cleanerId: link.cleaner_id, mode, priority })
                  }
                />

                <RemoveLinkButton
                  name={name}
                  onRemove={() => remove.mutate({ propertyId, cleanerId: link.cleaner_id })}
                />
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-2 border-t pt-3">
        <label className="flex flex-1 flex-col gap-1 text-xs text-muted-foreground">
          {t('panel.apartments.cleaners.add')}
          <NativeSelect value={adding} onChange={(event) => setAdding(event.target.value)}>
            <option value="">{t('panel.apartments.cleaners.addPlaceholder')}</option>
            {available.map((person) => (
              <option key={person.id} value={person.id}>
                {nameOf(person)}
              </option>
            ))}
          </NativeSelect>
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
