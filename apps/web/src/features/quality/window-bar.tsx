'use client';

import { QUALITY_WINDOWS, type QualityWindow } from '@str-ops/shared';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { formatDay } from '@/lib/format-date';
import { useLanguage } from '@/lib/use-language';

interface WindowBarProps {
  value: QualityWindow;
  onChange: (next: QualityWindow) => void;
}

/** The five windows of the owner's decision of 2026-11-06. */
export function WindowBar({ value, onChange }: WindowBarProps) {
  const { t } = useTranslation();

  return (
    <div role="group" aria-label={t('panel.quality.window.label')} className="flex flex-wrap gap-2">
      {QUALITY_WINDOWS.map((window) => (
        <Button
          key={window}
          type="button"
          variant={window === value ? 'default' : 'outline'}
          className="h-11 px-3"
          aria-pressed={window === value}
          onClick={() => onChange(window)}
        >
          {t(`panel.quality.window.options.${window}`)}
        </Button>
      ))}
    </div>
  );
}

interface WindowCaptionProps {
  from: string;
  today: string;
}

/** The days a window really holds, and that its last days are not all in yet (§3.3). */
export function WindowCaption({ from, today }: WindowCaptionProps) {
  const { t } = useTranslation();
  const language = useLanguage();

  return (
    <p className="text-sm text-muted-foreground">
      {t('panel.quality.window.range', {
        from: formatDay(from, language),
        to: formatDay(today, language),
      })}
      {' · '}
      {t('panel.quality.window.bookingTail')}
    </p>
  );
}
