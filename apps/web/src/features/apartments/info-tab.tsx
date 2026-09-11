'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { serverErrorText } from '@/lib/server-error';

import {
  childrenOf,
  infoDraftFrom,
  possibleParents,
  type InfoDraft,
  type Property,
  type PropertyDetail,
} from './schema';
import { useSaveInfo } from './use-apartments';

const SELECT_CLASS = 'h-9 rounded-md border bg-background px-2 text-sm';

interface InfoTabProps {
  property: PropertyDetail;
  /** The whole registry, for naming the parent and the units. */
  all: Property[];
}

/** A field Hostaway owns: shown, never offered for editing. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

/** `HH:MM:SS` from the database, as a person writes the time. */
function clock(value: string | null): string {
  return value === null ? '—' : value.slice(0, 5);
}

/**
 * What is known about a flat, in two halves.
 *
 * The first half belongs to Hostaway and is rewritten by every sync — the
 * name, the address, the size, and the check-in and check-out hours the
 * cleaning window is built from. It is shown and not editable: a field whose
 * contents quietly revert overnight teaches people not to trust the panel.
 *
 * The second half is the company's own — which listing this one is a unit of,
 * what the cleaner should know before she goes, and what the office should
 * know and the cleaner should not. Those are ours, and they are edited here.
 */
export function InfoTab({ property, all }: InfoTabProps) {
  const { t } = useTranslation();
  const save = useSaveInfo(property.id);
  const [draft, setDraft] = useState<InfoDraft>(() => infoDraftFrom(property));

  const units = childrenOf(all, property.id);
  const parents = possibleParents(all, property);
  const failure = save.isError ? serverErrorText(save.error) : null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    save.mutate(draft);
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">{t('panel.apartments.info.fromHostaway')}</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Fact label={t('panel.apartments.info.address')} value={property.address ?? '—'} />
          <Fact label={t('panel.apartments.info.city')} value={property.city ?? '—'} />
          <Fact label={t('panel.apartments.info.timezone')} value={property.timezone} />
          <Fact
            label={t('panel.apartments.info.window')}
            value={`${clock(property.check_out_time)} — ${clock(property.check_in_time)}`}
          />
          <Fact
            label={t('panel.apartments.info.size')}
            value={t('panel.apartments.info.sizeValue', {
              bedrooms: property.bedrooms ?? 0,
              guests: property.max_guests ?? 0,
            })}
          />
          <Fact label={t('panel.apartments.info.listingId')} value={String(property.id)} />
        </div>
        <p className="text-xs text-muted-foreground">{t('panel.apartments.info.hostawayHint')}</p>
      </section>

      <form className="flex flex-col gap-4" onSubmit={submit}>
        <h2 className="text-sm font-medium">{t('panel.apartments.info.ours')}</h2>

        <div className="flex flex-col gap-1">
          <Label htmlFor="property-parent">{t('panel.apartments.info.parent')}</Label>
          <select
            id="property-parent"
            className={SELECT_CLASS}
            value={draft.parentId === null ? '' : String(draft.parentId)}
            onChange={(event) =>
              setDraft({
                ...draft,
                parentId: event.target.value === '' ? null : Number(event.target.value),
              })
            }
          >
            <option value="">{t('panel.apartments.info.noParent')}</option>
            {parents.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">{t('panel.apartments.info.parentHint')}</p>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">{t('panel.apartments.info.units')}</span>
          {units.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('panel.apartments.info.noUnits')}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {units.map((unit) => (
                <li key={unit.id} className="text-sm">
                  <Link className="underline" href={`/apartments/${unit.id}`}>
                    {unit.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="cleaner-notes">{t('panel.apartments.info.cleanerNotes')}</Label>
          <Textarea
            id="cleaner-notes"
            rows={3}
            value={draft.cleanerNotes}
            onChange={(event) => setDraft({ ...draft, cleanerNotes: event.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            {t('panel.apartments.info.cleanerNotesHint')}
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="internal-notes">{t('panel.apartments.info.internalNotes')}</Label>
          <Textarea
            id="internal-notes"
            rows={3}
            value={draft.internalNotes}
            onChange={(event) => setDraft({ ...draft, internalNotes: event.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            {t('panel.apartments.info.internalNotesHint')}
          </p>
        </div>

        {failure === null ? null : (
          <div role="alert" className="flex flex-col gap-1">
            <p className="text-sm text-destructive">{failure.text}</p>
            {failure.detail === null ? null : (
              <p className="text-xs text-muted-foreground">{failure.detail}</p>
            )}
          </div>
        )}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? t('panel.apartments.info.saving') : t('panel.apartments.info.save')}
          </Button>
          {save.isSuccess && !save.isPending ? (
            <span role="status" className="text-sm text-muted-foreground">
              {t('panel.apartments.info.saved')}
            </span>
          ) : null}
        </div>
      </form>
    </div>
  );
}
