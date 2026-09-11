'use client';

import { useTranslation } from 'react-i18next';

import { serverErrorText } from '@/lib/server-error';

import type { HostSettingsPatch } from './schema';
import { useHostSettings, useSaveHostSettings } from './use-settings';

interface ToggleProps {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}

/**
 * One switch and what it costs.
 *
 * The hint is tied to the control with `aria-describedby` rather than left
 * as a paragraph nearby: these two settings both loosen something, and the
 * sentence explaining what has to reach whoever is listening rather than
 * only whoever is looking.
 */
function Toggle({ id, label, hint, checked, disabled, onChange }: ToggleProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="checkbox"
          className="size-4"
          checked={checked}
          disabled={disabled}
          aria-describedby={`${id}-hint`}
          onChange={(event) => onChange(event.target.checked)}
        />
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
      </div>
      <p id={`${id}-hint`} className="pl-6 text-xs text-muted-foreground">
        {hint}
      </p>
    </div>
  );
}

/**
 * The two switches that belong to the company.
 *
 * Each one saves itself the moment it is pressed, and sends only itself:
 * `update_host_settings` reads a missing parameter as "not part of this
 * call", so the other switch cannot be undone by a stale copy of the form.
 */
export function HostToggles() {
  const { t } = useTranslation();
  const settings = useHostSettings();
  const save = useSaveHostSettings();

  if (settings.isPending) {
    return <p className="text-sm text-muted-foreground">{t('panel.settings.workflow.loading')}</p>;
  }
  if (settings.isError || settings.data === null || settings.data === undefined) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t('panel.settings.loadError')}
      </p>
    );
  }

  const host = settings.data;
  const failure = save.isError ? serverErrorText(save.error) : null;
  const write = (patch: HostSettingsPatch) => save.mutate(patch);

  return (
    <div className="flex flex-col gap-4">
      <Toggle
        id="parallel-start"
        label={t('panel.settings.parallelStart')}
        hint={t('panel.settings.parallelStartHint')}
        checked={host.parallel_start_allowed}
        disabled={save.isPending}
        onChange={(next) => write({ parallelStartAllowed: next })}
      />

      <Toggle
        id="gallery-allowed"
        label={t('panel.settings.gallery')}
        hint={t('panel.settings.galleryHint')}
        checked={host.gallery_allowed}
        disabled={save.isPending}
        onChange={(next) => write({ galleryAllowed: next })}
      />

      {failure === null ? null : (
        <div role="alert" className="flex flex-col gap-1">
          <p className="text-sm text-destructive">{failure.text}</p>
          {failure.detail === null ? null : (
            <p className="text-xs text-muted-foreground">{failure.detail}</p>
          )}
        </div>
      )}

      {save.isPending ? (
        <span role="status" className="text-sm text-muted-foreground">
          {t('panel.settings.saving')}
        </span>
      ) : save.isSuccess ? (
        <span role="status" className="text-sm text-muted-foreground">
          {t('panel.settings.saved')}
        </span>
      ) : null}
    </div>
  );
}
