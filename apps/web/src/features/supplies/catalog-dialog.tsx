'use client';

import { FALLBACK_LANGUAGE, SUPPORTED_LANGUAGES } from '@str-ops/shared';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { serverErrorText } from '@/lib/server-error';

import {
  isCatalogItemArchived,
  SUPPLY_UNITS,
  type CatalogItem,
  type CatalogItemDraft,
} from './schema';
import {
  useArchiveCatalogItem,
  useCatalog,
  useCompanyLanguage,
  useSaveCatalogItem,
} from './use-supplies';

interface CatalogDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** A fresh entry with its id already minted, so a retry after a lost connection replays. */
function emptyDraft(): CatalogItemDraft {
  return { id: crypto.randomUUID(), name: '', name_i18n: {}, unit: 'pcs' };
}

function draftOf(item: CatalogItem): CatalogItemDraft {
  return { id: item.id, name: item.name, name_i18n: item.name_i18n, unit: item.unit };
}

/**
 * The company's list of consumables: what the phone offers on a request.
 *
 * Names are written in the company language, with a field per other
 * language the apps speak. An entry is never deleted, only taken off the
 * list, because old requests point at it.
 */
export function CatalogDialog({ open, onOpenChange }: CatalogDialogProps) {
  const { t } = useTranslation();
  const catalog = useCatalog();
  const companyLanguage = useCompanyLanguage();
  const save = useSaveCatalogItem();
  const archive = useArchiveCatalogItem();
  const [showArchived, setShowArchived] = useState(false);
  const [draft, setDraft] = useState<CatalogItemDraft>(emptyDraft);
  const [isEditing, setIsEditing] = useState(false);

  const language = companyLanguage.data ?? FALLBACK_LANGUAGE;
  const otherLanguages = SUPPORTED_LANGUAGES.filter((code) => code !== language);
  const items = (catalog.data ?? []).filter(
    (item) => showArchived || !isCatalogItemArchived(item),
  );
  const failed = [save, archive].find((mutation) => mutation.isError);
  const failure = failed === undefined ? null : serverErrorText(failed.error);
  const isBusy = save.isPending || archive.isPending;

  const resetForm = () => {
    setDraft(emptyDraft());
    setIsEditing(false);
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    save.mutate(draft, { onSuccess: resetForm });
  };
  const startEditing = (item: CatalogItem) => {
    setDraft(draftOf(item));
    setIsEditing(true);
  };
  const setTranslation = (code: string, text: string) =>
    setDraft((current) => ({ ...current, name_i18n: { ...current.name_i18n, [code]: text } }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('panel.supplies.catalog.title')}</DialogTitle>
          <DialogDescription>{t('panel.supplies.catalog.description')}</DialogDescription>
        </DialogHeader>

        {catalog.isPending ? (
          <p className="text-sm text-muted-foreground">{t('panel.supplies.catalog.loading')}</p>
        ) : catalog.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {t('panel.supplies.catalog.loadError')}
          </p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('panel.supplies.catalog.empty')}</p>
        ) : (
          <div className="max-h-80 overflow-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('panel.supplies.catalog.name')}</TableHead>
                  <TableHead>{t('panel.supplies.catalog.unit')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => {
                  const archived = isCatalogItemArchived(item);
                  return (
                    <TableRow key={item.id} className={archived ? 'text-muted-foreground' : ''}>
                      <TableCell>
                        <span className="font-medium">{item.name}</span>
                        {otherLanguages
                          .filter((code) => (item.name_i18n[code] ?? '').trim() !== '')
                          .map((code) => (
                            <span key={code} className="block text-xs text-muted-foreground">
                              {code}: {item.name_i18n[code]}
                            </span>
                          ))}
                        {archived ? (
                          <Badge variant="outline" className="ml-2">
                            {t('panel.supplies.catalog.archived')}
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell>{t(`supplies.units.${item.unit}`)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {archived ? null : (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={isBusy}
                              onClick={() => startEditing(item)}
                            >
                              {t('panel.supplies.catalog.edit')}
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={isBusy}
                            onClick={() => archive.mutate({ itemId: item.id, archived: !archived })}
                          >
                            {archived
                              ? t('panel.supplies.catalog.restore')
                              : t('panel.supplies.catalog.archive')}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => setShowArchived(event.target.checked)}
          />
          {t('panel.supplies.catalog.showArchived')}
        </label>

        <form onSubmit={submit} className="flex flex-col gap-3 border-t pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="catalog-name">
                {t('panel.supplies.catalog.name')} (
                {t(`panel.supplies.catalog.languages.${language}`)})
              </Label>
              <Input
                id="catalog-name"
                required
                maxLength={120}
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="catalog-unit">{t('panel.supplies.catalog.unit')}</Label>
              <select
                id="catalog-unit"
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={draft.unit}
                onChange={(event) =>
                  setDraft({ ...draft, unit: event.target.value as CatalogItemDraft['unit'] })
                }
              >
                {SUPPLY_UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {t(`supplies.units.${unit}`)}
                  </option>
                ))}
              </select>
            </div>
            {otherLanguages.map((code) => (
              <div key={code} className="flex flex-col gap-1.5">
                <Label htmlFor={`catalog-name-${code}`}>
                  {t('panel.supplies.catalog.translation', {
                    language: t(`panel.supplies.catalog.languages.${code}`),
                  })}
                </Label>
                <Input
                  id={`catalog-name-${code}`}
                  maxLength={120}
                  value={draft.name_i18n[code] ?? ''}
                  onChange={(event) => setTranslation(code, event.target.value)}
                />
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={isBusy || draft.name.trim() === ''}>
              {isEditing ? t('panel.supplies.catalog.save') : t('panel.supplies.catalog.add')}
            </Button>
            {isEditing ? (
              <Button type="button" variant="outline" onClick={resetForm}>
                {t('panel.supplies.catalog.cancelEdit')}
              </Button>
            ) : null}
          </div>
          {failure !== null ? (
            <p role="alert" className="text-sm text-destructive">
              {failure.text}
              {failure.detail !== null ? (
                <span className="block text-xs text-muted-foreground">{failure.detail}</span>
              ) : null}
            </p>
          ) : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}
