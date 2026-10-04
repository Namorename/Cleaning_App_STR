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
import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Logo } from '@/components/logo';
import { Separator } from '@/components/ui/separator';
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

interface NavListProps {
  items: readonly NavItem[];
  pathname: string;
  unreadBy: UnreadCounts;
  className?: string;
}

function NavList({ items, pathname, unreadBy, className }: NavListProps) {
  const { t } = useTranslation();

  return (
    <ul className={cn('flex flex-col gap-1', className)}>
      {items.map(({ href, key, icon: Icon }) => {
        const isActive = pathname.startsWith(href);
        const count = unreadBy[key] ?? 0;
        return (
          <li key={href}>
            <Link
              href={href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent',
                isActive && 'bg-accent font-medium',
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                {t(`panel.nav.${key}`)}
              </span>
              {count > 0 ? (
                <span
                  aria-label={t('panel.nav.unread', { count })}
                  className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground"
                >
                  {count}
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

interface NavSectionProps {
  label: string;
  children: ReactNode;
}

/** A group of the menu under its visible label, which also names it to a screen reader. */
function NavSection({ label, children }: NavSectionProps) {
  const labelId = useId();

  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-1">
      <span id={labelId} className="px-3 text-xs font-semibold text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

interface SidebarProps {
  email: string;
}

/**
 * The logo, the menu, and the signed-in address; the way out is not here.
 *
 * Signing out used to be a button right under the navigation, which is where
 * a hand goes by accident — one press and the shift stops for a password. It
 * asks first now, and it lives in Settings.
 *
 * The menu stays in view while a long page scrolls beside it (the owner's
 * shell, variant A of docs/design/decisions.md §2); a window too short for
 * the menu scrolls the menu itself.
 */
export function Sidebar({ email }: SidebarProps) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const unread = useUnreadSubjects();
  // How many conversations wait under each section. Threads hang off jobs
  // and breakages, so the count sits on the section that lists them.
  const unreadBy: UnreadCounts = {
    tasks: unread.tasks.size,
    problems: unread.problems.size,
  };

  return (
    <aside className="sticky top-0 flex h-dvh w-56 flex-col self-start overflow-y-auto border-r bg-card p-4">
      <Logo alt={t('panel.title')} className="mb-4" />
      <nav aria-label={t('panel.nav.label')} className="flex flex-1 flex-col gap-4">
        {NAV_GROUPS.map((group) => (
          <NavSection key={group.key} label={t(`panel.nav.groups.${group.key}`)}>
            <NavList items={group.items} pathname={pathname} unreadBy={unreadBy} />
          </NavSection>
        ))}
        <NavList items={[SETTINGS]} pathname={pathname} unreadBy={unreadBy} className="mt-auto" />
      </nav>
      <div className="mt-4 flex flex-col gap-2">
        <Separator />
        <span className="truncate text-xs text-muted-foreground" title={email}>
          {email}
        </span>
      </div>
    </aside>
  );
}
