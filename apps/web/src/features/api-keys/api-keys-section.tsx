'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
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
import { ConfirmDialog } from '@/features/team/confirm-dialog';
import { formatDateTime } from '@/lib/format-date';
import { useLanguage } from '@/lib/use-language';

import { KeyFormDialog } from './key-form-dialog';
import type { ApiKey, CreatedKey } from './schema';
import { useApiKeys, useRevokeApiKey } from './use-api-keys';

const STATE_VARIANT: Record<ApiKey['state'], 'default' | 'secondary' | 'destructive' | 'outline'> = {
  active: 'default',
  expired: 'secondary',
  revoked: 'outline',
  suspended: 'destructive',
  invalid: 'outline',
};

type Open =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'edit'; apiKey: ApiKey }
  | { kind: 'revoke'; apiKey: ApiKey }
  | { kind: 'created'; created: CreatedKey };

/**
 * «Settings → API» (docs/api-v1.md §11): the company's keys, for admins.
 *
 * The list shows every admin's keys: a key belongs to the company, and the
 * admin who leaves takes her keys' validity with her (they show as suspended)
 * — whoever remains must see them to revoke them. A key is never shown again
 * after its creation: the list has its first twelve characters only.
 */
export function ApiKeysSection() {
  const { t } = useTranslation();
  const language = useLanguage();
  const keys = useApiKeys();
  const revoke = useRevokeApiKey();
  const [open, setOpen] = useState<Open>({ kind: 'none' });
  const close = () => setOpen({ kind: 'none' });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" className="h-11" onClick={() => setOpen({ kind: 'create' })}>
          {t('panel.settings.api.create')}
        </Button>
        <Link href="/developers" className="text-sm text-primary underline-offset-4 hover:underline">
          {t('panel.settings.api.docs')}
        </Link>
      </div>

      {keys.isPending ? (
        <LoadingState>{t('panel.settings.api.loading')}</LoadingState>
      ) : keys.isError ? (
        <ErrorState message={t('panel.settings.api.loadError')} error={keys.error} />
      ) : keys.data.length === 0 ? (
        <EmptyState>{t('panel.settings.api.empty')}</EmptyState>
      ) : (
        <ul className="flex flex-col gap-2" aria-label={t('panel.settings.api.title')}>
          {keys.data.map((apiKey) => (
            <li key={apiKey.id} className="flex flex-col gap-2 rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{apiKey.name}</span>
                <code className="text-xs text-muted-foreground">{apiKey.prefix}…</code>
                <Badge variant={STATE_VARIANT[apiKey.state]}>
                  {t(`panel.settings.api.state.${apiKey.state === 'invalid' ? 'revoked' : apiKey.state}`)}
                </Badge>
              </div>
              {apiKey.state === 'suspended' ? (
                <p className="text-xs text-destructive">{t('panel.settings.api.state.suspendedHint')}</p>
              ) : null}
              <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_minmax(0,1fr)]">
                <dt className="text-muted-foreground">{t('panel.settings.api.columns.access')}</dt>
                <dd>
                  {t(`panel.settings.api.form.presets.${apiKey.preset}.label`)} ·{' '}
                  <span className="text-muted-foreground">{apiKey.effectiveScopes.join(', ')}</span>
                </dd>
                <dt className="text-muted-foreground">{t('panel.settings.api.columns.properties')}</dt>
                <dd>
                  {apiKey.propertyIds === null
                    ? t('panel.settings.api.allProperties')
                    : t('panel.settings.api.properties', { count: apiKey.propertyIds.length })}
                </dd>
                <dt className="text-muted-foreground">{t('panel.settings.api.columns.expires')}</dt>
                <dd>
                  {apiKey.expiresAt === null
                    ? t('panel.settings.api.never')
                    : formatDateTime(apiKey.expiresAt, language)}
                </dd>
                <dt className="text-muted-foreground">{t('panel.settings.api.columns.lastUsed')}</dt>
                <dd>
                  {apiKey.lastUsedAt === null
                    ? t('panel.settings.api.neverUsed')
                    : formatDateTime(apiKey.lastUsedAt, language)}
                </dd>
              </dl>
              {apiKey.revokedAt === null ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`${t('panel.settings.api.edit')}: ${apiKey.name}`}
                    onClick={() => setOpen({ kind: 'edit', apiKey })}
                  >
                    {t('panel.settings.api.edit')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`${t('panel.settings.api.revoke')}: ${apiKey.name}`}
                    onClick={() => setOpen({ kind: 'revoke', apiKey })}
                  >
                    {t('panel.settings.api.revoke')}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {revoke.isError ? <ErrorState error={revoke.error} /> : null}

      {open.kind === 'create' ? (
        <KeyFormDialog onClose={close} onCreated={(created) => setOpen({ kind: 'created', created })} />
      ) : null}
      {open.kind === 'edit' ? (
        <KeyFormDialog apiKey={open.apiKey} onClose={close} onCreated={close} />
      ) : null}
      {open.kind === 'revoke' ? (
        <ConfirmDialog
          title={t('panel.settings.api.revokeTitle', { name: open.apiKey.name })}
          lines={[t('panel.settings.api.revokeLine1'), t('panel.settings.api.revokeLine2')]}
          confirmLabel={t('panel.settings.api.revoke')}
          onClose={close}
          onConfirm={() => {
            revoke.mutate(open.apiKey.id);
            close();
          }}
        />
      ) : null}
      {open.kind === 'created' ? <CreatedKeyDialog created={open.created} onClose={close} /> : null}
    </div>
  );
}

interface CreatedKeyDialogProps {
  created: CreatedKey;
  onClose: () => void;
}

/**
 * The key's one showing. It lives in this dialog's props and nowhere else —
 * not in the query cache, not in storage — and is gone when the dialog closes.
 * Only «I have saved it» closes it: a stray click outside or Escape would throw
 * away the only copy.
 */
function CreatedKeyDialog({ created, onClose }: CreatedKeyDialogProps) {
  const { t } = useTranslation();
  const [copyState, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(created.key);
      setCopy('copied');
    } catch {
      setCopy('failed');
    }
  };

  return (
    <Dialog open disablePointerDismissal onOpenChange={() => undefined}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t('panel.settings.api.created.title')}</DialogTitle>
          <DialogDescription>{t('panel.settings.api.created.hint')}</DialogDescription>
        </DialogHeader>
        <Input
          readOnly
          value={created.key}
          aria-label={created.api_key.name}
          className="font-mono text-xs"
          onFocus={(event) => event.target.select()}
        />
        {copyState === 'failed' ? (
          <p role="alert" className="text-sm text-destructive">
            {t('panel.settings.api.created.copyFailed')}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" className="h-11" onClick={() => void copy()}>
            {copyState === 'copied'
              ? t('panel.settings.api.created.copied')
              : t('panel.settings.api.created.copy')}
          </Button>
          <Button type="button" className="h-11" onClick={onClose}>
            {t('panel.settings.api.created.done')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
