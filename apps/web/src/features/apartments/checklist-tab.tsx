'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { serverErrorText } from '@/lib/server-error';

import {
  checklistProblem,
  emptyItem,
  emptyModule,
  moveAt,
  removeAt,
  replaceModule,
  type ChecklistModule,
  type Property,
} from './schema';
import {
  useChecklist,
  useChecklistOwner,
  useCopyChecklist,
  useSaveChecklist,
} from './use-apartments';

const SELECT_CLASS = 'h-9 rounded-md border bg-background px-2 text-sm';

interface ChecklistTabProps {
  propertyId: number;
  /** The registry, for the listing a checklist can be copied from. */
  all: Property[];
}

/**
 * What a cleaner ticks off in this flat.
 *
 * A unit with no checklist of its own is cleaned by its parent's — that is
 * `resolve_checklist_property`, and the snapshot follows it silently. Silently
 * is right for a cleaning and wrong for an editor: somebody editing what looks
 * like this flat's list would in fact be writing a new one and quietly ending
 * the inheritance. So the tab says whose list is on screen before anything
 * else.
 *
 * Order is the meaning of the list — a cleaner reads it top to bottom, and
 * `save_property_checklist` writes `sort_order` from the position in the
 * array. The arrows are not decoration, they are the field.
 *
 * Translations are not edited here, the same as in the task form: a manager
 * types the company language, and the RPC keeps whatever translations a row
 * already had when the payload does not mention them.
 */
export function ChecklistTab({ propertyId, all }: ChecklistTabProps) {
  const { t } = useTranslation();
  const checklist = useChecklist(propertyId);
  const owner = useChecklistOwner(propertyId);
  const save = useSaveChecklist(propertyId);
  const copy = useCopyChecklist(propertyId);

  /** Null until the manager touches it — until then the server's answer shows. */
  const [draft, setDraft] = useState<ChecklistModule[] | null>(null);
  const [source, setSource] = useState('');

  // Derived rather than copied into state by an effect: a checklist that
  // arrives late still appears, and dropping the draft back to null is how a
  // copy re-reads what the server now holds.
  const modules = draft ?? checklist.data ?? [];
  const isInherited = owner.data !== undefined && owner.data !== propertyId;
  const inheritedFrom = all.find((one) => one.id === owner.data)?.name ?? '';
  const problem = checklistProblem(modules);
  const failure = save.isError
    ? serverErrorText(save.error)
    : copy.isError
      ? serverErrorText(copy.error)
      : null;

  const others = all.filter((one) => one.id !== propertyId && one.status !== 'archived');

  const setModules = (next: ChecklistModule[]) => setDraft(next);

  const copyFrom = () => {
    if (source === '') {
      return;
    }
    // The copy replaces what is here, so the draft is dropped and re-read.
    copy.mutate(Number(source), { onSuccess: () => setDraft(null) });
  };

  if (checklist.isPending) {
    return <p className="text-sm text-muted-foreground">{t('panel.apartments.loading')}</p>;
  }
  if (checklist.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t('panel.apartments.checklist.loadError')}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {isInherited ? (
        <p role="status" className="rounded-md border p-2 text-sm">
          {t('panel.apartments.checklist.inherited', { name: inheritedFrom })}
        </p>
      ) : null}

      {modules.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('panel.apartments.checklist.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {modules.map((section, moduleAt) => (
            <li
              key={section.id ?? `new-${moduleAt}`}
              className="flex flex-col gap-2 rounded-md border p-3"
            >
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-1 flex-col gap-1 text-xs text-muted-foreground">
                  {t('panel.apartments.checklist.moduleTitle')}
                  <Input
                    aria-label={t('panel.apartments.checklist.moduleNumber', { at: moduleAt + 1 })}
                    value={section.title}
                    onChange={(event) =>
                      setModules(
                        replaceModule(modules, moduleAt, { ...section, title: event.target.value }),
                      )
                    }
                  />
                </label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={t('panel.apartments.checklist.moduleUp', { at: moduleAt + 1 })}
                  onClick={() => setModules(moveAt(modules, moduleAt, -1))}
                >
                  ↑
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={t('panel.apartments.checklist.moduleDown', { at: moduleAt + 1 })}
                  onClick={() => setModules(moveAt(modules, moduleAt, 1))}
                >
                  ↓
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setModules(removeAt(modules, moduleAt))}
                >
                  {t('panel.apartments.checklist.removeModule')}
                </Button>
              </div>

              <ul className="flex flex-col gap-2 pl-4">
                {section.items.map((item, itemAt) => (
                  <li key={item.id ?? `new-${itemAt}`} className="flex flex-wrap items-center gap-2">
                    <Input
                      className="flex-1"
                      aria-label={t('panel.apartments.checklist.itemNumber', {
                        module: moduleAt + 1,
                        at: itemAt + 1,
                      })}
                      value={item.title}
                      onChange={(event) =>
                        setModules(
                          replaceModule(modules, moduleAt, {
                            ...section,
                            items: section.items.map((one, at) =>
                              at === itemAt ? { ...one, title: event.target.value } : one,
                            ),
                          }),
                        )
                      }
                    />
                    <label className="flex items-center gap-1 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={item.is_optional}
                        onChange={(event) =>
                          setModules(
                            replaceModule(modules, moduleAt, {
                              ...section,
                              items: section.items.map((one, at) =>
                                at === itemAt ? { ...one, is_optional: event.target.checked } : one,
                              ),
                            }),
                          )
                        }
                      />
                      {t('panel.apartments.checklist.optional')}
                    </label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={t('panel.apartments.checklist.itemUp', {
                        module: moduleAt + 1,
                        at: itemAt + 1,
                      })}
                      onClick={() =>
                        setModules(
                          replaceModule(modules, moduleAt, {
                            ...section,
                            items: moveAt(section.items, itemAt, -1),
                          }),
                        )
                      }
                    >
                      ↑
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setModules(
                          replaceModule(modules, moduleAt, {
                            ...section,
                            items: removeAt(section.items, itemAt),
                          }),
                        )
                      }
                    >
                      {t('panel.apartments.checklist.removeItem')}
                    </Button>
                  </li>
                ))}
              </ul>

              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setModules(
                      replaceModule(modules, moduleAt, {
                        ...section,
                        items: [...section.items, emptyItem()],
                      }),
                    )
                  }
                >
                  {t('panel.apartments.checklist.addItem')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div>
        <Button
          type="button"
          variant="outline"
          onClick={() => setModules([...modules, emptyModule()])}
        >
          {t('panel.apartments.checklist.addModule')}
        </Button>
      </div>

      {problem === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {t(`panel.apartments.checklist.problems.${problem}`)}
        </p>
      )}

      {failure === null ? null : (
        <div role="alert" className="flex flex-col gap-1">
          <p className="text-sm text-destructive">{failure.text}</p>
          {failure.detail === null ? null : (
            <p className="text-xs text-muted-foreground">{failure.detail}</p>
          )}
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button
          type="button"
          disabled={problem !== null || save.isPending}
          onClick={() => save.mutate(modules)}
        >
          {save.isPending
            ? t('panel.apartments.checklist.saving')
            : t('panel.apartments.checklist.save')}
        </Button>
        {save.isSuccess && !save.isPending ? (
          <span role="status" className="text-sm text-muted-foreground">
            {t('panel.apartments.checklist.saved')}
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-end gap-2 border-t pt-3">
        <label className="flex flex-1 flex-col gap-1 text-xs text-muted-foreground">
          {t('panel.apartments.checklist.copyFrom')}
          <select
            className={SELECT_CLASS}
            value={source}
            onChange={(event) => setSource(event.target.value)}
          >
            <option value="">{t('panel.apartments.checklist.copyPlaceholder')}</option>
            {others.map((one) => (
              <option key={one.id} value={one.id}>
                {one.name}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="button"
          variant="outline"
          disabled={source === '' || copy.isPending}
          onClick={copyFrom}
        >
          {t('panel.apartments.checklist.copy')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('panel.apartments.checklist.copyHint')}</p>
    </div>
  );
}
