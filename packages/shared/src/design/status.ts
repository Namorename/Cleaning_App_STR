import type { Enums } from '../database.types';
import type { IconMeaning } from './icons';
import type { Tone } from './tokens';

/**
 * The tone of every status either app shows: 92 values onto the 13 tones.
 *
 * Before the redesign each screen decided for itself — five local maps in the
 * panel, the calendar's own three dot colours, the phone's urgent/calm pair —
 * and green meant "done" on one screen and "cancelled" or "my message" on
 * another. This is the one place that decides. Keys are `<area>.<value>`; the
 * seven database enums appear here value by value and are read through the
 * typed helpers below, which fail to compile the day `db:types` brings a value
 * this map does not have. The rest are states of the screens (the calendar's
 * marks, the phone's banners, an upload).
 *
 * The map is directions.json's `statusMap`, the one the owner approved on the
 * page (decisions, question 2).
 */
export const STATUS_TONE = {
  'tasks.unassigned': 'unassigned',
  'tasks.assigned': 'assigned',
  'tasks.accepted': 'assigned',
  'tasks.in_progress': 'inProgress',
  'tasks.paused': 'inProgress',
  'tasks.blocked': 'urgent',
  'tasks.done': 'done',
  'tasks.cancelled': 'cancelled',
  'tasks.expired': 'notHappened',
  /** «Просрочена · 21.09»: a cleaning still open after its day. */
  'tasks.tail': 'overdue',
  'tasks.flags.tooShort': 'urgent',
  'tasks.flags.parallel': 'neutral',
  'tasks.type.cleaning': 'neutral',
  'tasks.type.midstay': 'neutral',
  'tasks.type.maintenance': 'neutral',
  'tasks.type.inspection': 'neutral',
  'tasks.origin.booking': 'neutral',
  'tasks.origin.problem': 'neutral',
  'problems.open': 'unassigned',
  'problems.assigned': 'assigned',
  'problems.in_progress': 'inProgress',
  'problems.resolved': 'done',
  'problems.cancelled': 'cancelled',
  /** The archive is a flag beside the status chip (with the archive icon), not a status. */
  'problems.archived': 'neutral',
  'problems.priority.high': 'urgent',
  'problems.priority.normal': 'neutral',
  'problems.priority.low': 'neutral',
  'supplies.new': 'unassigned',
  'supplies.accepted': 'assigned',
  'supplies.ordered': 'inProgress',
  'supplies.fulfilled': 'done',
  'supplies.rejected': 'cancelled',
  'supplies.priority.urgent': 'urgent',
  'supplies.priority.normal': 'neutral',
  'steps.pending': 'neutral',
  'steps.done': 'done',
  'steps.skipped': 'cancelled',
  'steps.waived': 'cancelled',
  'steps.unsupported': 'neutral',
  'steps.required': 'neutral',
  'calendar.booking': 'booking',
  'calendar.block': 'block',
  'calendar.ownerStay': 'block',
  /** The «#» booking: the company's own, not a guest. */
  'calendar.serviceBooking': 'block',
  'calendar.today': 'today',
  'calendar.nobody': 'unassigned',
  'calendar.overdueRepair': 'overdue',
  'calendar.overdueRepairTechOff': 'urgent',
  'calendar.expired': 'notHappened',
  'calendar.cancelled': 'cancelled',
  'calendar.doubleBooking': 'urgent',
  /** «Бронь изменилась»: an amber ring with ⚠ round a started cleaning. */
  'calendar.bookingChanged': 'inProgress',
  'calendar.sdt': 'urgent',
  'calendar.villaShadow': 'neutral',
  'calendar.cut': 'neutral',
  'calendar.propertyMaintenance': 'inProgress',
  'calendar.group.open': 'neutral',
  'calendar.group.inWork': 'inProgress',
  'calendar.group.done': 'done',
  'bookingCard.new': 'booking',
  'bookingCard.modified': 'booking',
  'bookingCard.ownerStay': 'block',
  'bookingsTab.upcoming': 'booking',
  'property.active': 'neutral',
  'property.maintenance': 'inProgress',
  'property.archived': 'neutral',
  'team.inactive': 'cancelled',
  'dashboard.overdueRepairs': 'overdue',
  'dashboard.offRepairs': 'urgent',
  'dashboard.unassignedToday': 'urgent',
  'dashboard.stuck.overdue': 'overdue',
  'dashboard.stuck.technicianOff': 'urgent',
  'dashboard.stuck.nobody': 'unassigned',
  'phone.checkIn.sameDay': 'urgent',
  'phone.checkIn.none': 'neutral',
  'phone.kindBanner': 'neutral',
  'phone.pushNotice': 'urgent',
  'phone.permission.off': 'urgent',
  'phone.permission.notAsked': 'urgent',
  'phone.permission.channelOff': 'urgent',
  'phone.permission.provisional': 'neutral',
  'chat.unread': 'unread',
  'nav.unread': 'unread',
  'chat.ownBubble': 'neutral',
  'chat.pending': 'neutral',
  'media.local': 'neutral',
  'media.uploading': 'inProgress',
  'media.uploaded': 'done',
  'media.failed': 'urgent',
  'media.expired': 'cancelled',
  'media.source.gallery': 'neutral',
  'media.source.unknown': 'neutral',
} as const satisfies Readonly<Record<string, Tone>>;

export type StatusKey = keyof typeof STATUS_TONE;

export function taskStatusTone(status: Enums<'task_status'>): Tone {
  return STATUS_TONE[`tasks.${status}` as const];
}

export function taskTypeTone(type: Enums<'task_type'>): Tone {
  return STATUS_TONE[`tasks.type.${type}` as const];
}

export function problemStatusTone(status: Enums<'problem_status'>): Tone {
  return STATUS_TONE[`problems.${status}` as const];
}

export function problemPriorityTone(priority: Enums<'problem_priority'>): Tone {
  return STATUS_TONE[`problems.priority.${priority}` as const];
}

export function supplyStatusTone(status: Enums<'supply_request_status'>): Tone {
  return STATUS_TONE[`supplies.${status}` as const];
}

export function supplyPriorityTone(priority: Enums<'supply_priority'>): Tone {
  return STATUS_TONE[`supplies.priority.${priority}` as const];
}

export function propertyStatusTone(status: Enums<'property_status'>): Tone {
  return STATUS_TONE[`property.${status}` as const];
}

/**
 * The glyph a chip of each tone carries before its word. Colour is never the
 * only cue (the brief): the tones that have no glyph are told apart by the word
 * alone (`neutral`), by their form (`today`, `booking`, `block` — a pill, a
 * bar, a hatched bar) or are a badge (`unread`).
 */
export const TONE_ICON = {
  unassigned: 'status.nobody',
  assigned: 'status.assigned',
  inProgress: 'status.inProgress',
  done: 'status.done',
  overdue: 'status.overdue',
  notHappened: 'status.notHappened',
  cancelled: 'status.cancelled',
  urgent: 'status.urgent',
} as const satisfies Partial<Readonly<Record<Tone, IconMeaning>>>;

/** The statuses whose glyph is not their tone's: «Принята» adds ✓, «Пауза» is ‖, a failed upload ⚠. */
export const STATUS_ICON = {
  'tasks.accepted': 'status.accepted',
  'tasks.paused': 'status.paused',
  'media.failed': 'status.warning',
} as const satisfies Partial<Readonly<Record<StatusKey, IconMeaning>>>;

/** The glyph of a status's chip, or null where the word stands alone. */
export function statusIcon(key: StatusKey): IconMeaning | null {
  const own: Partial<Readonly<Record<StatusKey, IconMeaning>>> = STATUS_ICON;
  const byTone: Partial<Readonly<Record<Tone, IconMeaning>>> = TONE_ICON;
  return own[key] ?? byTone[STATUS_TONE[key]] ?? null;
}

/** How a step's circle on a cleaning is drawn (directions.json, tones[].step). */
export interface StepCircle {
  readonly draw: 'ring' | 'disc';
  /** The ring's stroke, px / dp. */
  readonly ringWidth?: number;
  /** The step's number, or an icon. */
  readonly glyph: 'number' | IconMeaning;
  /** Which colour of the tone the glyph takes. */
  readonly glyphColor: 'fg' | 'onMark';
}

/**
 * By the tone of the step's state (`steps.*` in `STATUS_TONE`): a step to do
 * is a ring with its number, a done one a filled disc with ✓, a skipped or
 * waived one a pale ring with ✕. The circle's colour is the tone's `mark`.
 */
export const STEP_CIRCLE = {
  neutral: { draw: 'ring', ringWidth: 2, glyph: 'number', glyphColor: 'fg' },
  done: { draw: 'disc', glyph: 'status.done', glyphColor: 'onMark' },
  cancelled: { draw: 'ring', ringWidth: 2, glyph: 'status.cancelled', glyphColor: 'fg' },
} as const satisfies Partial<Readonly<Record<Tone, StepCircle>>>;

export type MarkShape =
  | 'bar'
  | 'hatchedBar'
  | 'circle'
  | 'diamond'
  | 'framedSquare'
  | 'ring'
  | 'square';

/**
 * The calendar's marks: the shape each tone is drawn with in a day's lane,
 * coloured by the tone's `mark`. The shape carries the meaning where colour
 * cannot (decisions, question 3: «Без исполнителя» is a diamond). Not marks of
 * their own: «Срочно» is a red ring with «!» round another mark (overdue's
 * colours), «Бронь изменилась» an amber ring with ⚠ (inProgress), «сегодня»
 * the accent pill in the day's header and the column's underlay.
 */
export const CALENDAR_MARK_SHAPE = {
  booking: 'bar',
  block: 'hatchedBar',
  assigned: 'circle',
  inProgress: 'circle',
  done: 'circle',
  unassigned: 'diamond',
  overdue: 'framedSquare',
  notHappened: 'ring',
  cancelled: 'square',
} as const satisfies Partial<Readonly<Record<Tone, MarkShape>>>;

/** The two hatches differ by slant, because their colours nearly meet under deuteranopia. */
export const HATCH_ANGLE = {
  notHappened: 45,
  block: 135,
} as const satisfies Partial<Readonly<Record<Tone, number>>>;
