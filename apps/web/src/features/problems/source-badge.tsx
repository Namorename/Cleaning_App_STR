'use client';

import { ICONS, SIGNAL_SOURCE_LOOK, isGuestSource, type GuestSource } from '@str-ops/shared';
import { MessageSquare, Star, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * The glyphs of the two sources, imported one by one; the test holds each to the name the shared
 * map gives it (`ICONS['source.review' | 'source.message']`).
 */
export const SOURCE_GLYPHS: Readonly<Record<GuestSource, LucideIcon>> = {
  review: Star,
  message: MessageSquare,
};

/** Their Lucide names, for the test. */
export const SOURCE_GLYPH_NAMES: Readonly<Record<GuestSource, string>> = {
  review: ICONS[SIGNAL_SOURCE_LOOK.review.icon],
  message: ICONS[SIGNAL_SOURCE_LOOK.message.icon],
};

/**
 * Filled with the tone's mark, its glyph and word in onMark (`SIGNAL_SOURCE_LOOK`): gold for a
 * review, the booking's terracotta for a chat — written out whole, as Tailwind needs them. In the
 * dark theme the terracotta gets the booking's ring, as the calendar's bar does, so it does not sink
 * into a dark card.
 */
const SOURCE_CLASSES: Readonly<Record<GuestSource, string>> = {
  review: 'bg-tone-today-mark text-tone-today-on-mark',
  message:
    'bg-tone-booking-mark text-tone-booking-on-mark dark:inset-ring dark:inset-ring-tone-booking-border',
};

interface SourceBadgeProps {
  /** problems.source or guest_signals.kind; nothing is drawn for a report of the staff. */
  source: string | null | undefined;
  className?: string;
}

/**
 * «Из отзыва» with a star, «Из чата» with a bubble: where a task from a guest came from, the same
 * chip on the board, in the list, on the task's page and on the cards of «Гости» (owner,
 * 2026-11-11). The word is always there — the colour and the glyph are never the only cue.
 */
export function SourceBadge({ source, className }: SourceBadgeProps) {
  const { t } = useTranslation();
  if (!isGuestSource(source)) {
    return null;
  }
  const Glyph = SOURCE_GLYPHS[source];
  return (
    <Badge
      data-source={source}
      className={cn('font-semibold', SOURCE_CLASSES[source], className)}
    >
      <Glyph aria-hidden="true" fill={source === 'review' ? 'currentColor' : 'none'} />
      {t(SIGNAL_SOURCE_LOOK[source].label)}
    </Badge>
  );
}
