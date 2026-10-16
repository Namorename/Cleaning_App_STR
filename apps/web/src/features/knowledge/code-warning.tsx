'use client';

import { SUPPORTED_LANGUAGES } from '@str-ops/shared';
import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useLanguage } from '@/lib/use-language';

/**
 * Access codes stay out of articles (the owner's decision 3 of 2026-10-17;
 * their own closed block is F27). Always on screen while an article is
 * written, in all three languages — whoever writes, in whichever language,
 * reads it in hers — the panel's own first.
 */
export function CodeWarning() {
  const { t } = useTranslation();
  const language = useLanguage();
  const order = [language, ...SUPPORTED_LANGUAGES.filter((code) => code !== language)];

  return (
    <div
      role="note"
      aria-label={t('panel.knowledge.editor.codeWarningLabel')}
      className="flex gap-2 rounded-lg border border-tone-urgent-border bg-tone-urgent-bg p-3 text-sm text-tone-urgent-fg"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <ul className="flex flex-col gap-1">
        {order.map((code, index) => (
          <li key={code} lang={code} className={index === 0 ? 'font-medium' : undefined}>
            {t('panel.knowledge.editor.codeWarning', { lng: code })}
          </li>
        ))}
      </ul>
    </div>
  );
}
