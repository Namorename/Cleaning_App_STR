/**
 * The icons of both apps by what they mean, as canonical Lucide names
 * (kebab-case, as on lucide.dev). The owner's decision 7: Lucide in the panel
 * (`lucide-react`, installed) and in the phone (`lucide-react-native` with
 * `react-native-svg`, from build 1.2.0).
 *
 * Each app imports the components it draws one by one — the whole set of some
 * 1 800 icons does not belong in a bundle — and checks its own against this
 * map; the meanings are
 * what keeps «Задания» the same picture in the panel's menu and on the phone's
 * tab. The pictures follow the comparison page's sprite (ICONS in
 * docs/design/redesign-directions.html).
 */
export const ICONS = {
  // The panel's menu (decisions §4) and the phone's tabs.
  'nav.dashboard': 'layout-grid',
  'nav.calendar': 'calendar',
  /** «Уборки» (`/tasks`). */
  'nav.tasks': 'brush-cleaning',
  /** «Задания» (`/problems`). */
  'nav.problems': 'clipboard-list',
  /** «Заявки» in the panel, «Расходники» on the phone. */
  'nav.supplies': 'package',
  /** «Объекты». */
  'nav.apartments': 'building-2',
  'nav.team': 'users',
  'nav.settings': 'settings',
  /** The phone: «Мои уборки». */
  'nav.myTasks': 'house',
  /** The phone: «Свободные». */
  'nav.queue': 'inbox',
  /** The technician: «Мои работы». */
  'nav.myJobs': 'wrench',
  /** The panel's menu folds to a strip of icons, and opens out again. */
  'nav.collapse': 'panel-left-close',
  'nav.expand': 'panel-left-open',
  /** The panel on a phone: the button that opens the menu. */
  'nav.menu': 'menu',

  'action.add': 'plus',
  'action.back': 'chevron-left',
  'action.next': 'chevron-right',
  /** A select or a section that opens. */
  'action.expand': 'chevron-down',
  'action.close': 'x',
  'action.more': 'ellipsis',
  'action.search': 'search',
  /** Always with the destructive tone's colours (directions.json, rules: destructive). */
  'action.delete': 'trash',
  'action.retry': 'rotate-cw',
  'action.takePhoto': 'camera',
  'action.fromGallery': 'image',
  'action.showPassword': 'eye',
  'action.openChat': 'message-square',

  // The glyphs of the status chips (`TONE_ICON`, `STATUS_ICON`).
  'status.nobody': 'user-round',
  'status.assigned': 'user-round',
  'status.accepted': 'user-round-check',
  'status.inProgress': 'play',
  'status.paused': 'pause',
  'status.done': 'check',
  'status.overdue': 'clock',
  'status.notHappened': 'circle',
  'status.cancelled': 'x',
  'status.urgent': 'circle-alert',
  /** ⚠ — only a booking that changed or doubled, and an error. */
  'status.warning': 'triangle-alert',
  'status.archived': 'archive',

  /** A problem's technician, beside his name. */
  'meta.technician': 'wrench',
} as const;

export type IconMeaning = keyof typeof ICONS;
export type LucideIconName = (typeof ICONS)[IconMeaning];

/**
 * How an icon is drawn where the outline alone would not tell it apart: the
 * person of «Назначено» is filled and the one of «Без исполнителя» dashed
 * (the page's glyph: `stroke-dasharray` 2.4 2 on the 24-unit grid), «В работе»
 * a filled ▶. Lucide's icons are outlines; `filled` sets `fill` to the stroke's
 * colour. An active tab's icon is filled too (shape.activeTab), whatever it is.
 */
export const ICON_STYLE = {
  'status.nobody': 'dashed',
  'status.assigned': 'filled',
  'status.inProgress': 'filled',
} as const satisfies Partial<Readonly<Record<IconMeaning, 'filled' | 'dashed'>>>;
