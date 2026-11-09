'use client';

import type { Preset } from '@str-ops/shared/src/api/registry';
import { useMutation } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { PageHeader } from '@/components/page-header';
import { ErrorState } from '@/components/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { EMPTY_DRAFT, EXPIRY_CHOICES, type KeyDraft } from '@/features/api-keys/schema';
import { ScopePicker } from '@/features/api-keys/scope-picker';
import { PropertyPicker } from '@/features/team/property-picker';
import { useProperties } from '@/features/team/use-team';
import { useSupabase } from '@/lib/supabase/use-client';

import { approveConnection } from './api';
import type { ConsentRequest } from './authorize-request';
import { redirectBack } from './redirect';

/** A new connection starts as one of these; full access or a custom set is a change in Settings → API. */
const CONSENT_PRESETS: readonly Preset[] = ['read_only', 'operator'];

const EXPIRY_LABEL: Record<string, string> = {
  '30': 'panel.settings.api.form.expiry30',
  '90': 'panel.settings.api.form.expiry90',
  '365': 'panel.settings.api.form.expiry365',
  never: 'panel.settings.api.form.expiryNever',
};

interface ConsentFormProps {
  request: ConsentRequest;
  /** Only an admin allows a connection; anyone else may only deny it. */
  isAdmin: boolean;
  /** Where the browser goes on leaving: the client's redirect. Replaced in tests. */
  navigate?: (url: string) => void;
}

function goTo(url: string) {
  window.location.assign(url);
}

/**
 * The consent page's card (docs/mcp-oauth.md): who asks, where the answer
 * goes, and — for an admin — what the connection may do, chosen as for a key.
 * «Allow» records it and sends the browser back with a code; «Deny» sends it
 * back with access_denied. Both answers carry the issuer (RFC 9207).
 */
export function ConsentForm({ request, isAdmin, navigate = goTo }: ConsentFormProps) {
  const { t } = useTranslation();
  const baseId = useId();
  const client = useSupabase();
  const clientName = request.clientName ?? t('panel.oauth.unnamedClient');
  const [draft, setDraft] = useState<KeyDraft>({ ...EMPTY_DRAFT, name: clientName.slice(0, 80) });
  const patch = (next: Partial<KeyDraft>) => setDraft((current) => ({ ...current, ...next }));

  const approve = useMutation({
    mutationFn: () => approveConnection(client, request, draft),
    onSuccess: (code) =>
      navigate(
        redirectBack(request.redirectUri, { code, state: request.state, iss: request.issuer }),
      ),
  });
  const denyHref = redirectBack(request.redirectUri, {
    error: 'access_denied',
    error_description: 'The admin denied the connection',
    state: request.state,
    iss: request.issuer,
  });

  const canAllow =
    isAdmin &&
    draft.name.trim() !== '' &&
    (!draft.restrict || draft.propertyIds.length > 0) &&
    !approve.isPending;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canAllow) {
      approve.mutate();
    }
  };

  return (
    <div className="flex w-full max-w-2xl flex-col gap-4">
      <PageHeader title={t('panel.oauth.title')} />
      <Card>
        <CardHeader>
          <CardTitle>{t('panel.oauth.asks', { client: clientName })}</CardTitle>
          <CardDescription>
            {t('panel.oauth.returnsTo', { target: request.redirectLabel })}
          </CardDescription>
        </CardHeader>
        <form onSubmit={submit}>
          <CardContent className="flex flex-col gap-4">
            {request.isLoopback ? (
              <Alert>
                <AlertDescription>{t('panel.oauth.loopbackWarning')}</AlertDescription>
              </Alert>
            ) : null}

            {isAdmin ? (
              <ConsentFields baseId={baseId} draft={draft} patch={patch} />
            ) : (
              <Alert variant="destructive">
                <AlertDescription>{t('panel.oauth.adminOnly')}</AlertDescription>
              </Alert>
            )}

            {approve.isError ? <ErrorState error={approve.error} /> : null}
          </CardContent>
          <CardFooter className="flex flex-wrap justify-end gap-2">
            <a
              href={denyHref}
              className={buttonVariants({ variant: 'outline', className: 'h-11' })}
              onClick={(event) => {
                event.preventDefault();
                navigate(denyHref);
              }}
            >
              {t('panel.oauth.deny')}
            </a>
            {isAdmin ? (
              <Button type="submit" className="h-11" disabled={!canAllow} focusableWhenDisabled>
                {approve.isPending ? t('panel.oauth.allowing') : t('panel.oauth.allow')}
              </Button>
            ) : null}
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}

interface ConsentFieldsProps {
  baseId: string;
  draft: KeyDraft;
  patch: (next: Partial<KeyDraft>) => void;
}

/** What the connection may do: the key form's own fields, two presets to start from. */
function ConsentFields({ baseId, draft, patch }: ConsentFieldsProps) {
  const { t } = useTranslation();
  const properties = useProperties();

  return (
    <>
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
          {t('panel.oauth.nameHint')}
        </p>
      </div>

      <p className="text-sm text-muted-foreground">{t('panel.oauth.presetHint')}</p>
      <ScopePicker
        presets={CONSENT_PRESETS}
        value={{ preset: draft.preset, scopes: draft.scopes }}
        onChange={(choice) => patch({ preset: choice.preset, scopes: choice.scopes })}
      />

      <div className="flex flex-col gap-1">
        <label htmlFor={`${baseId}-expiry`} className="text-sm font-medium">
          {t('panel.settings.api.form.expiry')}
        </label>
        <NativeSelect
          id={`${baseId}-expiry`}
          value={draft.expiresInDays === null ? 'never' : String(draft.expiresInDays)}
          onChange={(event) =>
            patch({
              expiresInDays:
                event.target.value === 'never'
                  ? null
                  : (Number(event.target.value) as 30 | 90 | 365),
            })
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

      <p className="text-xs text-muted-foreground">{t('panel.oauth.manageHint')}</p>
    </>
  );
}

/** A request the page will not answer: shown here, never sent on (an unchecked redirect is an open one). */
export function ConsentFailed({
  reason,
}: {
  reason: 'badRequest' | 'unknownClient' | 'badRedirect';
}) {
  const { t } = useTranslation();
  return (
    <div className="flex w-full max-w-md flex-col gap-4">
      <PageHeader title={t('panel.oauth.failedTitle')} />
      <p>{t(`panel.oauth.reasons.${reason}`)}</p>
    </div>
  );
}
