'use client';

import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { LabelledField } from '@/components/labelled-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { formatDay } from '@/lib/format-date';
import { useLanguage } from '@/lib/use-language';

import type { AnalyticsAddress } from './address';
import { isValidPeriod, MAX_PERIOD_DAYS, PERIOD_PRESETS, type Period } from './period';
import { NAME_MODES, type NameMode } from './schema';

interface PeriodBarProps {
  address: AnalyticsAddress;
  period: Period;
  /** The period the figures are compared with; null when the comparison is off. */
  previous: Period | null;
  /** The demo listings may be counted in only on the local stand. */
  isLocalStand: boolean;
  onChange: (next: AnalyticsAddress) => void;
}

/**
 * The period of the page: the quick choices, two days of its own, the
 * comparison with the period before, how names are shown — and, on the local
 * stand only, the demo listings.
 */
export function PeriodBar({ address, period, previous, isLocalStand, onChange }: PeriodBarProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const id = useId();
  // The two days as typed: a pair that makes no period stays here, unsent.
  const [draft, setDraft] = useState<Period>(period);
  const [shown, setShown] = useState<Period>(period);
  if (shown.from !== period.from || shown.to !== period.to) {
    setShown(period);
    setDraft(period);
  }
  const isDraftValid = isValidPeriod(draft);

  const setDay = (part: keyof Period, value: string) => {
    const next = { ...draft, [part]: value };
    setDraft(next);
    if (isValidPeriod(next)) {
      onChange({ ...address, preset: null, custom: next });
    }
  };

  return (
    <section
      aria-label={t('panel.analytics.period.label')}
      className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
    >
      <div
        role="group"
        aria-label={t('panel.analytics.period.label')}
        className="flex flex-wrap gap-2"
      >
        {PERIOD_PRESETS.map((preset) => (
          <Button
            key={preset}
            type="button"
            variant={address.preset === preset ? 'default' : 'outline'}
            className="h-11 px-3"
            aria-pressed={address.preset === preset}
            onClick={() => onChange({ ...address, preset, custom: null })}
          >
            {t(`panel.analytics.period.presets.${preset}`)}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <LabelledField id={`${id}-from`} label={t('panel.analytics.period.from')}>
          <Input
            id={`${id}-from`}
            type="date"
            className="h-11 w-40"
            value={draft.from}
            max={draft.to}
            onChange={(event) => setDay('from', event.target.value)}
          />
        </LabelledField>
        <LabelledField id={`${id}-to`} label={t('panel.analytics.period.to')}>
          <Input
            id={`${id}-to`}
            type="date"
            className="h-11 w-40"
            value={draft.to}
            min={draft.from}
            onChange={(event) => setDay('to', event.target.value)}
          />
        </LabelledField>
        <LabelledField id={`${id}-names`} label={t('panel.analytics.names.label')}>
          <NativeSelect
            id={`${id}-names`}
            className="h-11"
            value={address.names}
            onChange={(event) => onChange({ ...address, names: event.target.value as NameMode })}
          >
            {NAME_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {t(`panel.analytics.names.${mode}`)}
              </option>
            ))}
          </NativeSelect>
        </LabelledField>
      </div>

      {isDraftValid ? null : (
        <p role="alert" className="text-sm text-destructive">
          {t('panel.analytics.period.invalid', { max: MAX_PERIOD_DAYS })}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <Switch
            checked={address.compare}
            onCheckedChange={(compare) => onChange({ ...address, compare })}
          />
          {t('panel.analytics.period.compare')}
        </label>
        {isLocalStand ? (
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <Switch
              checked={address.includeTest}
              onCheckedChange={(includeTest) => onChange({ ...address, includeTest })}
            />
            {t('panel.analytics.includeTest')}
          </label>
        ) : null}
        {previous === null ? null : (
          <span className="text-sm text-muted-foreground">
            {t('panel.analytics.period.comparedWith', {
              from: formatDay(previous.from, language),
              to: formatDay(previous.to, language),
            })}
          </span>
        )}
      </div>
    </section>
  );
}
