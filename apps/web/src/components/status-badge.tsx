import {
  ICON_STYLE,
  STATUS_TONE,
  statusIcon,
  type IconMeaning,
  type StatusKey,
} from '@str-ops/shared';
import {
  Archive,
  Check,
  Circle,
  CircleAlert,
  Clock,
  Pause,
  Play,
  TriangleAlert,
  UserRound,
  UserRoundCheck,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';

/**
 * The glyphs of the status chips (`TONE_ICON`, `STATUS_ICON` of the shared
 * contract), imported one by one: the panel does not ship all of Lucide. The
 * test holds each to the name the shared map gives it.
 */
const GLYPHS = {
  'status.nobody': UserRound,
  'status.assigned': UserRound,
  'status.accepted': UserRoundCheck,
  'status.inProgress': Play,
  'status.paused': Pause,
  'status.done': Check,
  'status.overdue': Clock,
  'status.notHappened': Circle,
  'status.cancelled': X,
  'status.urgent': CircleAlert,
  'status.warning': TriangleAlert,
  'status.archived': Archive,
} as const satisfies Partial<Record<IconMeaning, LucideIcon>>;

type StatusGlyphMeaning = keyof typeof GLYPHS;

export const STATUS_GLYPH_MEANINGS = Object.keys(GLYPHS) as StatusGlyphMeaning[];

/** The dash of «nobody»'s person on Lucide's 24-unit grid (`ICON_STYLE`). */
const DASHED = '2.4 2';

/**
 * A status's glyph as the contract draws it: «Назначено» a filled person,
 * «Без исполнителя» a dashed one, «В работе» a filled ▶ (`ICON_STYLE`).
 * Out of the screen reader's way — the word beside it says the status.
 */
export function StatusGlyph({ meaning }: { meaning: StatusGlyphMeaning }) {
  const Icon = GLYPHS[meaning];
  const styles: Partial<Record<IconMeaning, 'filled' | 'dashed'>> = ICON_STYLE;
  const style = styles[meaning];
  return (
    <Icon
      aria-hidden="true"
      fill={style === 'filled' ? 'currentColor' : 'none'}
      strokeDasharray={style === 'dashed' ? DASHED : undefined}
    />
  );
}

function isGlyph(meaning: IconMeaning): meaning is StatusGlyphMeaning {
  return meaning in GLYPHS;
}

/**
 * The contract's key for a status read as a plain string — a column the
 * schema types as text, a code from Hostaway — or null when the contract has
 * no such status, and the chip stays neutral.
 */
export function statusKey(area: string, value: string): StatusKey | null {
  const key = `${area}.${value}`;
  return Object.hasOwn(STATUS_TONE, key) ? (key as StatusKey) : null;
}

interface StatusBadgeProps {
  /**
   * The status as the contract keys it: `problems.in_progress`, `tasks.tail`;
   * null for one the contract does not know, drawn neutral and without a glyph.
   */
  status: StatusKey | null;
  children: ReactNode;
  className?: string;
}

/**
 * A status chip (5.4): the tone of its status, its glyph before the word
 * where the contract gives one — so «Назначено» and «В работе» differ in
 * shape as well as colour.
 */
export function StatusBadge({ status, children, className }: StatusBadgeProps) {
  const meaning = status === null ? null : statusIcon(status);
  return (
    <Badge tone={status === null ? 'neutral' : STATUS_TONE[status]} className={className}>
      {meaning === null || !isGlyph(meaning) ? null : <StatusGlyph meaning={meaning} />}
      {children}
    </Badge>
  );
}
