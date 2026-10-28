'use client';

import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { effectiveScopes } from '@str-ops/shared/src/api/registry';
import { API_REGISTRY } from '@str-ops/shared/src/api/registry-data';

import { ErrorState } from '@/components/states';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { PropertyPicker } from '@/features/team/property-picker';
import { useProperties } from '@/features/team/use-team';

import { draftOf, EMPTY_DRAFT, EXPIRY_CHOICES, type ApiKey, type CreatedKey, type KeyDraft } from './schema';
import { ScopePicker } from './scope-picker';
import { useCreateApiKey, useUpdateApiKey } from './use-api-keys';

interface KeyFormDialogProps {
  /** Absent for a new key. */
  apiKey?: ApiKey;
  onClose: () => void;
  /** A new key was made: its one showing is the caller's to give. */
  onCreated: (created: CreatedKey) => void;
}

const EXPIRY_LABEL: Record<string, string> = {
  '30': 'panel.settings.api.form.expiry30',
  '90': 'panel.settings.api.form.expiry90',
  '365': 'panel.settings.api.form.expiry365',
  never: 'panel.settings.api.form.expiryNever',
};

/**
 * A new key, or a change to one.
 *
 * Full access is «like an admin's password»: the warning says so, and the key's
 * name has to be typed again — on a new key, and on a change that raises an
 * existing one to it. The database asks for the same, so the form is not the
 * only gate. A change applies to the key's next request and is journalled.
 */
export function KeyFormDialog({ apiKey, onClose, onCreated }: KeyFormDialogProps) {
  const { t } = useTranslation();
  const baseId = useId();
  const isNew = apiKey === undefined;
  const [draft, setDraft] = useState<KeyDraft>(isNew ? EMPTY_DRAFT : draftOf(apiKey));
  const properties = useProperties();
  const create = useCreateApiKey();
  const update = useUpdateApiKey();
  const mutation = isNew ? create : update;

  const patch = (next: Partial<KeyDraft>) => setDraft((current) => ({ ...current, ...next }));

  const needsConfirmation = draft.preset === 'full' && (isNew || apiKey.preset !== 'full');
  const isConfirmed = !needsConfirmation || draft.confirmation.trim() === draft.name.trim();
  const hasScopes = effectiveScopes(draft.preset, draft.scopes, API_REGISTRY).length > 0;
  const hasProperties = !draft.restrict || draft.propertyIds.length > 0;
  const canSave =
    draft.name.trim() !== '' && hasScopes && hasProperties && isConfirmed && !mutation.isPending;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSave) {
      return;
    }
    if (isNew) {
      create.mutate(draft, { onSuccess: onCreated });
    } else {
      update.mutate({ id: apiKey.id, draft }, { onSuccess: onClose });
    }
  };

  return (
    // While a key is being made the form stays: closing it then would lose the
    // key's one showing, with the key already saved.
    <Dialog open onOpenChange={(open) => (open || mutation.isPending ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>
              {isNew
                ? t('panel.settings.api.form.createTitle')
                : t('panel.settings.api.form.editTitle', { name: apiKey.name })}
            </DialogTitle>
            {isNew ? null : <DialogDescription>{t('panel.settings.api.form.appliesNow')}</DialogDescription>}
          </DialogHeader>

          <div className="flex flex-col gap-1">
            <label htmlFor={`${baseId}-name`} className="text-sm font-medium">
              {t('panel.settings.api.form.name')}
            </label>
            <Input
              id={`${baseId}-name`}
              value={draft.name}
              maxLength={80}
              required
              aria-describedby={`${baseId}-name-hint`}
              onChange={(event) => patch({ name: event.target.value })}
            />
            <p id={`${baseId}-name-hint`} className="text-xs text-muted-foreground">
              {t('panel.settings.api.form.nameHint')}
            </p>
          </div>

          <ScopePicker
            value={{ preset: draft.preset, scopes: draft.scopes }}
            onChange={(choice) => patch({ preset: choice.preset, scopes: choice.scopes, confirmation: '' })}
          />

          {draft.preset === 'full' ? (
            <div role="alert" className="flex flex-col gap-2 rounded-md border border-destructive p-3">
              <p className="text-sm text-destructive">{t('panel.settings.api.form.fullWarning')}</p>
              {needsConfirmation ? (
                <div className="flex flex-col gap-1">
                  <label htmlFor={`${baseId}-confirm`} className="text-sm">
                    {t('panel.settings.api.form.confirmName', { name: draft.name.trim() })}
                  </label>
                  <Input
                    id={`${baseId}-confirm`}
                    value={draft.confirmation}
                    autoComplete="off"
                    aria-invalid={!isConfirmed}
                    onChange={(event) => patch({ confirmation: event.target.value })}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {isNew ? (
            <div className="flex flex-col gap-1">
              <label htmlFor={`${baseId}-expiry`} className="text-sm font-medium">
                {t('panel.settings.api.form.expiry')}
              </label>
              <NativeSelect
                id={`${baseId}-expiry`}
                value={draft.expiresInDays === null ? 'never' : String(draft.expiresInDays)}
                onChange={(event) =>
                  patch({ expiresInDays: event.target.value === 'never' ? null : (Number(event.target.value) as 30 | 90 | 365) })
                }
              >
                {EXPIRY_CHOICES.map((choice) => {
                  const value = choice === null ? 'never' : String(choice);
                  return (
                    <option key={value} value={value}>
                      {t(EXPIRY_LABEL[value])}
                    </option>
                  );
                })}
              </NativeSelect>
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            <div className="flex items-start gap-2">
              <input
                id={`${baseId}-restrict`}
                type="checkbox"
                className="mt-1 size-4"
                checked={draft.restrict}
                aria-describedby={`${baseId}-restrict-hint`}
                onChange={(event) => patch({ restrict: event.target.checked })}
              />
              <div className="flex flex-col">
                <label htmlFor={`${baseId}-restrict`} className="text-sm font-medium">
                  {t('panel.settings.api.form.restrict')}
                </label>
                <p id={`${baseId}-restrict-hint`} className="text-xs text-muted-foreground">
                  {t('panel.settings.api.form.restrictHint')}
                </p>
              </div>
            </div>
            {draft.restrict ? (
              <PropertyPicker
                properties={properties.data ?? []}
                selected={draft.propertyIds}
                isPending={properties.isPending}
                onChange={(next) => patch({ propertyIds: next })}
              />
            ) : null}
          </div>

          {mutation.isError ? <ErrorState error={mutation.error} /> : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={mutation.isPending}
              focusableWhenDisabled
              onClick={onClose}
            >
              {t('panel.cancel')}
            </Button>
            <Button type="submit" className="h-11" disabled={!canSave} focusableWhenDisabled>
              {mutation.isPending
                ? t(isNew ? 'panel.settings.api.form.creating' : 'panel.settings.api.form.saving')
                : isNew
                  ? t('panel.settings.api.create')
                  : t('panel.settings.api.form.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
