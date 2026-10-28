'use client';

import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * Access codes stay out of articles (the owner's decision 3 of 2026-10-16;
 * their own closed block is F27). Always on screen while an article is
 * written, in the panel's language (the owner's decision of 2026-10-17; it
 * was all three at once before).
 */
export function CodeWarning() {
  const { t } = useTranslation();

  return (
    <div
      role="note"
      aria-label={t('panel.knowledge.editor.codeWarningLabel')}
      className="flex gap-2 rounded-lg border border-tone-urgent-border bg-tone-urgent-bg p-3 text-sm text-tone-urgent-fg"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p className="font-medium">{t('panel.knowledge.editor.codeWarning')}</p>
    </div>
  );
}
