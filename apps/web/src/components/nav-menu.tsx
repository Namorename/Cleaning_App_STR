'use client';

import {
  BrushCleaning,
  Building2,
  Calendar,
  ClipboardList,
  LayoutGrid,
  Package,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Fragment, useId, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useUnreadSubjects } from '@/features/chat/use-chat';
import { cn } from '@/lib/utils';

type NavKey =
  | 'dashboard'
  | 'calendar'
  | 'tasks'
  | 'problems'
  | 'supplies'
  | 'apartments'
  | 'team'
  | 'settings';

interface NavItem {
  href: string;
  key: NavKey;
  /**
   * The picture of `ICONS['nav.<key>']` (@str-ops/shared), imported by name:
   * the whole Lucide set does not belong in the bundle. The sidebar's test
   * holds each one to the map.
   */
  icon: LucideIcon;
}

interface NavGroup {
  key: 'work' | 'reference';
  items: readonly NavItem[];
}

/**
 * The owner's order (docs/design/decisions.md §4): the day's work first, then
 * the places it is done in and the people who do it.
 */
const NAV_GROUPS: readonly NavGroup[] = [
  {
    key: 'work',
    items: [
      { href: '/dashboard', key: 'dashboard', icon: LayoutGrid },
      { href: '/calendar', key: 'calendar', icon: Calendar },
      { href: '/tasks', key: 'tasks', icon: BrushCleaning },
      { href: '/problems', key: 'problems', icon: ClipboardList },
      { href: '/supplies', key: 'supplies', icon: Package },
    ],
  },
  {
    key: 'reference',
    items: [
      { href: '/apartments', key: 'apartments', icon: Building2 },
      { href: '/team', key: 'team', icon: Users },
    ],
  },
];

/** On its own at the bottom of the menu, in neither group. */
const SETTINGS: NavItem = { href: '/settings', key: 'settings', icon: Settings };

type UnreadCounts = Partial<Record<NavKey, number>>;

/**
 * A row of the menu, and the toggle under it: 44 px high, the panel's smallest
 * target (`TOUCH_TARGET.panelMin`); folded, a 44 px square around its icon.
 */
export function navRowClass(isCollapsed: boolean): string {
  return cn(
    'relative flex min-h-11 items-center gap-2 rounded-md text-sm hover:bg-accent',
    isCollapsed ? 'size-11 justify-center' : 'px-3',
  );
}

interface StripTooltipProps {
  /** The name the icon stands for. */
  label: string;
  isCollapsed: boolean;
  /** The row itself — a link or a button — without its content. */
  render: ReactElement;
  children: ReactNode;
}

/**
 * In the strip the names leave the screen, so each icon says its name in a
 * tooltip, on a hover and on the keyboard's focus. In the open menu the name
 * is on screen and the tooltip is off; the row stays the same element either
 * way, so folding the menu does not rebuild it.
 */
export function StripTooltip({ label, isCollapsed, render, children }: StripTooltipProps) {
  return (
    <Tooltip disabled={!isCollapsed}>
      <TooltipTrigger render={render}>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

interface UnreadCountProps {
  count: number;
  isCollapsed: boolean;
}

/** How many conversations wait under a section; on a folded icon, a small badge at its corner. */
function UnreadCount({ count, isCollapsed }: UnreadCountProps) {
  const { t } = useTranslation();

  return (
    <span
      aria-label={t('panel.nav.unread', { count })}
      className={cn(
        'rounded-full bg-primary font-medium text-primary-foreground',
        isCollapsed
          ? 'absolute top-0.5 right-0.5 min-w-4 px-1 text-center text-[10px] leading-4'
          : 'ml-auto px-2 py-0.5 text-xs',
      )}
    >
      {count}
    </span>
  );
}

interface NavListProps {
  items: readonly NavItem[];
  pathname: string;
  unreadBy: UnreadCounts;
  isCollapsed: boolean;
  onNavigate?: () => void;
  className?: string;
}

function NavList({ items, pathname, unreadBy, isCollapsed, onNavigate, className }: NavListProps) {
  const { t } = useTranslation();

  return (
    <ul className={cn('flex flex-col gap-1', className)}>
      {items.map(({ href, key, icon: Icon }) => {
        const label = t(`panel.nav.${key}`);
        const isActive = pathname.startsWith(href);
        const count = unreadBy[key] ?? 0;
        return (
          <li key={href}>
            <StripTooltip
              label={label}
              isCollapsed={isCollapsed}
              render={
                <Link
                  href={href}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={onNavigate}
                  className={cn(navRowClass(isCollapsed), isActive && 'bg-accent font-medium')}
                />
              }
            >
              <Icon
                className={cn('shrink-0', isCollapsed ? 'size-5' : 'size-4')}
                aria-hidden="true"
              />
              <span className={cn('min-w-0 truncate', isCollapsed && 'sr-only')}>{label}</span>
              {count > 0 ? <UnreadCount count={count} isCollapsed={isCollapsed} /> : null}
            </StripTooltip>
          </li>
        );
      })}
    </ul>
  );
}

interface NavSectionProps {
  label: string;
  isCollapsed: boolean;
  children: ReactNode;
}

/**
 * A group of the menu under its visible label, which also names it to a
 * screen reader. Folded, the label has no room: the group keeps its name for
 * the reader, and a separator marks it for the eye (docs/design/decisions.md
 * §4, the proposal).
 */
function NavSection({ label, isCollapsed, children }: NavSectionProps) {
  const labelId = useId();

  if (isCollapsed) {
    return (
      <div role="group" aria-label={label} className="flex flex-col gap-1">
        {children}
      </div>
    );
  }
  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-1">
      <span id={labelId} className="px-3 text-xs font-semibold text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

interface NavMenuProps {
  /** Folded to the strip of icons: names in tooltips, a separator between the groups. */
  isCollapsed?: boolean;
  /** After a section is chosen: the phone's sheet closes on it. */
  onNavigate?: () => void;
  id?: string;
  className?: string;
}

/**
 * The panel's sections in the owner's groups, Settings apart at the bottom —
 * the one menu of the side panel and of the phone's sheet.
 */
export function NavMenu({ isCollapsed = false, onNavigate, id, className }: NavMenuProps) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const unread = useUnreadSubjects();
  // How many conversations wait under each section. Threads hang off jobs
  // and breakages, so the count sits on the section that lists them.
  const unreadBy: UnreadCounts = {
    tasks: unread.tasks.size,
    problems: unread.problems.size,
  };
  const rows = { pathname, unreadBy, isCollapsed, onNavigate };

  return (
    <nav
      id={id}
      aria-label={t('panel.nav.label')}
      className={cn('flex flex-1 flex-col gap-4', className)}
    >
      {NAV_GROUPS.map((group, index) => (
        <Fragment key={group.key}>
          {isCollapsed && index > 0 ? <Separator /> : null}
          <NavSection label={t(`panel.nav.groups.${group.key}`)} isCollapsed={isCollapsed}>
            <NavList items={group.items} {...rows} />
          </NavSection>
        </Fragment>
      ))}
      <NavList items={[SETTINGS]} {...rows} className="mt-auto" />
    </nav>
  );
}
