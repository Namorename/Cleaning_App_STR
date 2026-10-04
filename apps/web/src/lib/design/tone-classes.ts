import type { Tone } from '@str-ops/shared';

/**
 * The Tailwind classes of the thirteen tones, written out whole: Tailwind
 * finds a class only where its full name stands in the source, so a class
 * built as `bg-tone-${tone}-mark` would draw nothing. The colours behind them
 * are the generated `--tone-*` variables (`theme.generated.css`); a test holds
 * every `*-tone-*` class in the panel's source to a colour the generator wrote.
 */

/** The calendar's mark of each tone: a dot, a square, a disc. */
export const TONE_MARK_BG: Readonly<Record<Tone, string>> = {
  neutral: 'bg-tone-neutral-mark',
  unassigned: 'bg-tone-unassigned-mark',
  assigned: 'bg-tone-assigned-mark',
  inProgress: 'bg-tone-in-progress-mark',
  done: 'bg-tone-done-mark',
  overdue: 'bg-tone-overdue-mark',
  notHappened: 'bg-tone-not-happened-mark',
  cancelled: 'bg-tone-cancelled-mark',
  urgent: 'bg-tone-urgent-mark',
  today: 'bg-tone-today-mark',
  booking: 'bg-tone-booking-mark',
  block: 'bg-tone-block-mark',
  unread: 'bg-tone-unread-mark',
};

/**
 * A status chip of each tone: its words on its tinted fill. The frame shows
 * only where the tone has one to say (`ToneColors.border`): dashed for
 * «Без исполнителя» (decision 3), solid for «Просрочено»; elsewhere the
 * badge's border stays transparent, so no chip changes its size.
 */
export const TONE_BADGE: Readonly<Record<Tone, string>> = {
  neutral: 'bg-tone-neutral-bg text-tone-neutral-fg',
  unassigned:
    'border-dashed border-tone-unassigned-border bg-tone-unassigned-bg text-tone-unassigned-fg',
  assigned: 'bg-tone-assigned-bg text-tone-assigned-fg',
  inProgress: 'bg-tone-in-progress-bg text-tone-in-progress-fg',
  done: 'bg-tone-done-bg text-tone-done-fg',
  overdue: 'border-tone-overdue-border bg-tone-overdue-bg text-tone-overdue-fg',
  notHappened: 'bg-tone-not-happened-bg text-tone-not-happened-fg',
  cancelled: 'bg-tone-cancelled-bg text-tone-cancelled-fg',
  urgent: 'bg-tone-urgent-bg text-tone-urgent-fg',
  today: 'bg-tone-today-bg text-tone-today-fg',
  booking: 'bg-tone-booking-bg text-tone-booking-fg',
  block: 'bg-tone-block-bg text-tone-block-fg',
  unread: 'bg-tone-unread-mark text-tone-unread-on-mark',
};
