import { ICON_STYLE, ICONS, type IconMeaning, type LucideIconName } from '@str-ops/shared';
import type { LucideIcon, LucideProps } from 'lucide-react-native';
import Archive from 'lucide-react-native/icons/archive';
import BrushCleaning from 'lucide-react-native/icons/brush-cleaning';
import Building2 from 'lucide-react-native/icons/building-2';
import Calendar from 'lucide-react-native/icons/calendar';
import Camera from 'lucide-react-native/icons/camera';
import Check from 'lucide-react-native/icons/check';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import Circle from 'lucide-react-native/icons/circle';
import CircleAlert from 'lucide-react-native/icons/circle-alert';
import ClipboardList from 'lucide-react-native/icons/clipboard-list';
import Clock from 'lucide-react-native/icons/clock';
import Ellipsis from 'lucide-react-native/icons/ellipsis';
import Eye from 'lucide-react-native/icons/eye';
import EyeOff from 'lucide-react-native/icons/eye-off';
import House from 'lucide-react-native/icons/house';
import ImageGlyph from 'lucide-react-native/icons/image';
import Inbox from 'lucide-react-native/icons/inbox';
import LayoutGrid from 'lucide-react-native/icons/layout-grid';
import Menu from 'lucide-react-native/icons/menu';
import MessageSquare from 'lucide-react-native/icons/message-square';
import Package from 'lucide-react-native/icons/package';
import PanelLeftClose from 'lucide-react-native/icons/panel-left-close';
import PanelLeftOpen from 'lucide-react-native/icons/panel-left-open';
import Pause from 'lucide-react-native/icons/pause';
import Play from 'lucide-react-native/icons/play';
import Plus from 'lucide-react-native/icons/plus';
import RotateCw from 'lucide-react-native/icons/rotate-cw';
import Search from 'lucide-react-native/icons/search';
import Send from 'lucide-react-native/icons/send';
import Settings from 'lucide-react-native/icons/settings';
import StickyNote from 'lucide-react-native/icons/sticky-note';
import Trash from 'lucide-react-native/icons/trash';
import TriangleAlert from 'lucide-react-native/icons/triangle-alert';
import UserRound from 'lucide-react-native/icons/user-round';
import UserRoundCheck from 'lucide-react-native/icons/user-round-check';
import Users from 'lucide-react-native/icons/users';
import Wrench from 'lucide-react-native/icons/wrench';
import X from 'lucide-react-native/icons/x';
import type { ReactElement } from 'react';
import { StyleSheet, View, type ColorValue, type ViewStyle } from 'react-native';

import { IconSize, type IconSizeName } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { TONE_ROLE, type TextTone } from './text';

/**
 * The glyph of every name in the icon map (`ICONS`), each from its own module:
 * the package's barrel would carry all of Lucide's ~1 800 icons into the
 * bundle. Typed over every name the map uses, so a meaning added to `ICONS`
 * does not compile here until its glyph is imported; `__tests__/icon.test.tsx`
 * checks that each is the canonical Lucide icon of its name.
 */
export const LUCIDE_GLYPHS = {
  'layout-grid': LayoutGrid,
  calendar: Calendar,
  'brush-cleaning': BrushCleaning,
  'clipboard-list': ClipboardList,
  package: Package,
  'building-2': Building2,
  users: Users,
  settings: Settings,
  house: House,
  inbox: Inbox,
  wrench: Wrench,
  'panel-left-close': PanelLeftClose,
  'panel-left-open': PanelLeftOpen,
  menu: Menu,
  plus: Plus,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'chevron-down': ChevronDown,
  x: X,
  ellipsis: Ellipsis,
  search: Search,
  trash: Trash,
  'rotate-cw': RotateCw,
  camera: Camera,
  image: ImageGlyph,
  eye: Eye,
  'eye-off': EyeOff,
  'message-square': MessageSquare,
  send: Send,
  'user-round': UserRound,
  'user-round-check': UserRoundCheck,
  play: Play,
  pause: Pause,
  check: Check,
  clock: Clock,
  circle: Circle,
  'circle-alert': CircleAlert,
  'triangle-alert': TriangleAlert,
  archive: Archive,
  'sticky-note': StickyNote,
} as const satisfies Readonly<Record<LucideIconName, LucideIcon>>;

type IconLook = (typeof ICON_STYLE)[keyof typeof ICON_STYLE];

const LOOK_OF: Partial<Readonly<Record<IconMeaning, IconLook>>> = ICON_STYLE;

/** The dashed person of «Без исполнителя», as the comparison page draws it: 2.4 on, 2 off. */
const DASH: readonly number[] = [2.4, 2];

/**
 * What a meaning's drawing adds to Lucide's outline (`ICON_STYLE`): a filled
 * shape in the icon's own ink, or a dashed stroke. Only the props that are set
 * are returned — Lucide treats an explicit `fill: undefined` as no fill at
 * all, which SVG then paints black.
 */
export function glyphLook(
  name: IconMeaning,
  ink: ColorValue,
): Pick<LucideProps, 'fill' | 'strokeDasharray'> {
  switch (LOOK_OF[name]) {
    case 'filled':
      return { fill: ink };
    case 'dashed':
      return { strokeDasharray: [...DASH] };
    default:
      return {};
  }
}

/** The icon's box, so it holds its place in a row before the drawing lays out. */
const BOX = StyleSheet.create({
  small: { width: IconSize.small, height: IconSize.small },
  regular: { width: IconSize.regular, height: IconSize.regular },
} satisfies Readonly<Record<IconSizeName, ViewStyle>>);

export interface IconProps {
  /** What the icon means (`ICONS`); the picture and the way it is drawn follow from it. */
  name: IconMeaning;
  /**
   * `regular` by default: Lucide's 24-unit grid at 1:1, the box a button, a row
   * or a tab centres in its ≥ 48 dp target. `small` sits beside a chip's words.
   */
  size?: IconSizeName;
  /** The theme role it is drawn in, as text beside it would be; the main text colour by default. */
  tone?: TextTone;
  /** A colour of its own — a status tone, the tab bar's tint — drawn instead of `tone`. */
  color?: ColorValue;
  /**
   * Fills the drawing in its own ink, whatever the meaning: the active tab's
   * icon (directions.json, `shape.activeTab`). The rest of the meaning's look
   * (`ICON_STYLE`) stays.
   */
  isFilled?: boolean;
  /**
   * Makes the icon an image the screen reader stops on and reads by this name.
   * Without it the icon is decoration and hidden from the reader: the words
   * beside it, or the button around it, already say what it means.
   */
  accessibilityLabel?: string;
  testID?: string;
}

/**
 * An icon by its meaning, drawn from Lucide (owner's decision 7). The reader
 * semantics live on a plain `View` around the drawing: Lucide hands every
 * extra prop to each path of the icon as well, so a label given to the drawing
 * would be read once per path.
 */
export function Icon({
  name,
  size = 'regular',
  tone = 'default',
  color,
  isFilled = false,
  accessibilityLabel,
  testID,
}: IconProps) {
  const theme = useTheme();
  const ink = color ?? theme[TONE_ROLE[tone]];
  const Glyph = LUCIDE_GLYPHS[ICONS[name]];
  const look = isFilled ? { ...glyphLook(name, ink), fill: ink } : glyphLook(name, ink);
  const glyph = <Glyph size={IconSize[size]} color={ink} {...look} />;

  if (accessibilityLabel === undefined) {
    return (
      <View
        testID={testID}
        style={BOX[size]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {glyph}
      </View>
    );
  }

  return (
    <View
      testID={testID}
      style={BOX[size]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
    >
      {glyph}
    </View>
  );
}

/** What the tab bar hands the icon of a tab (`components/tab-bar.tsx`). */
export interface TabBarIconProps {
  focused: boolean;
  color: ColorValue;
  size: number;
}

/**
 * A tab's icon in the tab bar's tint, for `tabBarIcon`: an outline, filled
 * while the tab is active (directions.json, `shape.activeTab`). Decorative: the
 * tab is named by its title. The size handed over gives way to the token — the
 * bar centres the box either way.
 */
export function tabBarIcon(name: IconMeaning): (props: TabBarIconProps) => ReactElement {
  return function TabBarIcon({ focused, color }: TabBarIconProps) {
    return <Icon name={name} color={color} isFilled={focused} />;
  };
}
