'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { EmptyState, LoadingState } from '@/components/states';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { serverErrorText } from '@/lib/server-error';

import { LinkTerms, RemoveLinkButton } from './link-controls';
import { PropertyPicker } from './property-picker';
import { canHaveLinks, linksOf, MIN_PRIORITY, unlinkedProperties, type Staff } from './schema';
import { useCleanerLinks, useProperties, useRemoveCleanerLink, useSaveCleanerLink } from './use-team';

interface LinksEditorProps {
  staff: Staff;
  onClose: () => void;
}

/**
 * The listings one person works, and on what terms.
 *
 * Every control writes as it changes rather than collecting a form and saving
 * it: each row is one link and one statement about it, there is nothing to
 * submit together, and a "save" button over a list of independent rows only
 * invents a question about which of them it applies to.
 *
 * The refusal that matters here is "this listing already hands its work to
 * somebody" — only one person can be the automatic cleaner. It names her, so
 * the manager knows whose link to change first.
 *
 * Somebody who is not put on listings — a technician with a link from before
 * the rule, a cleaner since made a manager — still has the links listed, and
 * each can only be taken off: the server refuses a technician any new link and
 * any change of an old one (20261003110000), and nobody else is offered one.
 */
export function LinksEditor({ staff, onClose }: LinksEditorProps) {
  const { t } = useTranslation();
  const properties = useProperties();
  const links = useCleanerLinks();
  const save = useSaveCleanerLink();
  const remove = useRemoveCleanerLink();
  const [adding, setAdding] = useState<number[]>([]);

  const isLinkable = canHaveLinks(staff);
  const allProperties = properties.data ?? [];
  const allLinks = links.data ?? [];
  const rows = linksOf(allLinks, allProperties, staff.id);
  const available = unlinkedProperties(allLinks, allProperties, staff.id);

  const failure = save.isError
    ? serverErrorText(save.error)
    : remove.isError
      ? serverErrorText(remove.error)
      : null;

  /**
   * Open every listing that was ticked, one write each.
   *
   * One at a time rather than in parallel: `save_property_cleaner` answers
   * "this listing already has somebody fixed to it" by naming her, and a
   * burst of writes would turn one readable refusal into several at once.
   * A listing leaves the ticks the moment it is open, so a failure further on
   * leaves ticked exactly what is still closed: nothing has to be ticked
   * twice, and a second press never writes an open listing again over terms
   * set on its row since.
   */
  const add = () => {
    void (async () => {
      try {
        for (const propertyId of adding) {
          await save.mutateAsync({
            propertyId,
            cleanerId: staff.id,
            mode: 'claim',
            priority: MIN_PRIORITY,
          });
          setAdding((current) => current.filter((id) => id !== propertyId));
        }
      } catch {
        // Already on screen through `save.isError` — see `failure` below.
      }
    })();
  };

  return (
    <Sheet open onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetContent className="gap-4 overflow-y-auto p-4 sm:max-w-lg">
        <SheetHeader className="p-0">
          <SheetTitle>
            {t('panel.team.links.title', { name: staff.full_name ?? staff.email ?? '' })}
          </SheetTitle>
          <SheetDescription>
            {isLinkable ? t('panel.team.links.description') : t('panel.team.links.onlyRemove')}
          </SheetDescription>
        </SheetHeader>

        {links.isPending || properties.isPending ? (
          <LoadingState>{t('panel.team.loading')}</LoadingState>
        ) : (
          <div className="flex flex-col gap-3">
            {rows.length === 0 ? (
              <EmptyState>{t('panel.team.links.empty')}</EmptyState>
            ) : (
              <ul className="flex flex-col gap-2">
                {rows.map((row) => (
                  <li
                    key={row.propertyId}
                    className="flex flex-wrap items-end gap-2 rounded-md border p-2"
                  >
                    <span className="min-w-32 flex-1 text-sm font-medium">{row.name}</span>

                    <LinkTerms
                      name={row.name}
                      mode={row.mode}
                      priority={row.priority}
                      isEditable={isLinkable}
                      onChange={(mode, priority) =>
                        save.mutate({
                          propertyId: row.propertyId,
                          cleanerId: staff.id,
                          mode,
                          priority,
                        })
                      }
                    />

                    <RemoveLinkButton
                      name={row.name}
                      onRemove={() =>
                        remove.mutate({ propertyId: row.propertyId, cleanerId: staff.id })
                      }
                    />
                  </li>
                ))}
              </ul>
            )}

            {isLinkable ? (
              <div className="flex flex-col gap-2 border-t pt-3">
                <span className="text-xs text-muted-foreground">{t('panel.team.links.add')}</span>
                {available.length === 0 ? (
                  <EmptyState>{t('panel.team.links.addNone')}</EmptyState>
                ) : (
                  <>
                    {/* Ticking, not picking one at a time: a new cleaner is put on
                        a street or a building, and that is five listings, not one
                        listing five times over. */}
                    <PropertyPicker
                      properties={available}
                      selected={adding}
                      isPending={false}
                      onChange={setAdding}
                    />
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        disabled={adding.length === 0 || save.isPending}
                        onClick={add}
                      >
                        {t('panel.team.links.addButton')}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ) : null}

            {failure === null ? null : (
              <div role="alert" className="flex flex-col gap-1">
                <p className="text-sm text-destructive">{failure.text}</p>
                {failure.detail === null ? null : (
                  <p className="text-xs text-muted-foreground">{failure.detail}</p>
                )}
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
