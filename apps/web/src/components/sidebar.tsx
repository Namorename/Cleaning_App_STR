'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslation } from 'react-i18next';

import { Separator } from '@/components/ui/separator';
import { useUnreadSubjects } from '@/features/chat/use-chat';
import { cn } from '@/lib/utils';

/** The panel's sections, in the order the plan builds them. */
export const NAV_ITEMS = [
  { href: '/dashboard', key: 'dashboard' },
  { href: '/problems', key: 'problems' },
  { href: '/supplies', key: 'supplies' },
  { href: '/tasks', key: 'tasks' },
  { href: '/team', key: 'team' },
  { href: '/apartments', key: 'apartments' },
  { href: '/settings', key: 'settings' },
  { href: '/calendar', key: 'calendar' },
] as const;

interface SidebarProps {
  email: string;
}

/**
 * The signed-in address sits here; the way out does not.
 *
 * Signing out used to be a button right under the navigation, which is where
 * a hand goes by accident — one press and the shift stops for a password. It
 * asks first now, and it lives in Settings.
 */
export function Sidebar({ email }: SidebarProps) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const unread = useUnreadSubjects();
  // How many conversations wait under each section. Threads hang off jobs
  // and breakages, so the count sits on the section that lists them.
  const unreadBy: Partial<Record<(typeof NAV_ITEMS)[number]['key'], number>> = {
    tasks: unread.tasks.size,
    problems: unread.problems.size,
  };

  return (
    <aside className="flex w-56 flex-col border-r bg-card p-4">
      <div className="mb-4 text-lg font-semibold">{t('panel.title')}</div>
      <nav aria-label={t('panel.nav.label')} className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname.startsWith(item.href);
          const count = unreadBy[item.key] ?? 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent',
                isActive && 'bg-accent font-medium',
              )}
            >
              {t(`panel.nav.${item.key}`)}
              {count > 0 ? (
                <span
                  aria-label={t('panel.nav.unread', { count })}
                  className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground"
                >
                  {count}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto flex flex-col gap-2">
        <Separator />
        <span className="truncate text-xs text-muted-foreground" title={email}>
          {email}
        </span>
      </div>
    </aside>
  );
}
