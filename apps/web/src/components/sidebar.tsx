'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
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
  onSignOut: () => Promise<void>;
}

export function Sidebar({ email, onSignOut }: SidebarProps) {
  const { t } = useTranslation();
  const pathname = usePathname();

  return (
    <aside className="flex w-56 flex-col border-r bg-card p-4">
      <div className="mb-4 text-lg font-semibold">{t('panel.title')}</div>
      <nav aria-label={t('panel.nav.label')} className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'rounded-md px-3 py-2 text-sm hover:bg-accent',
                isActive && 'bg-accent font-medium',
              )}
            >
              {t(`panel.nav.${item.key}`)}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto flex flex-col gap-2">
        <Separator />
        <span className="truncate text-xs text-muted-foreground" title={email}>
          {email}
        </span>
        <form action={onSignOut}>
          <Button type="submit" variant="outline" size="sm" className="w-full">
            {t('panel.signOut')}
          </Button>
        </form>
      </div>
    </aside>
  );
}
