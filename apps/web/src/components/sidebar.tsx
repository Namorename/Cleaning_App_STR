'use client';

import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Logo } from '@/components/logo';
import { NavMenu, StripTooltip, navRowClass } from '@/components/nav-menu';
import { Separator } from '@/components/ui/separator';
import { TooltipProvider } from '@/components/ui/tooltip';
import { rememberSidebar } from '@/lib/sidebar-state';
import { cn } from '@/lib/utils';

interface SidebarProps {
  email: string;
  /** The width the manager left the menu at: the `sidebar` cookie, read by the layout. */
  isInitiallyCollapsed?: boolean;
}

/**
 * The logo, the menu, and the signed-in address; the way out is not here.
 *
 * Signing out used to be a button right under the navigation, which is where
 * a hand goes by accident — one press and the shift stops for a password. It
 * asks first now, and it lives in Settings.
 *
 * The owner's shell, variant A of docs/design/decisions.md §2: the menu stays
 * in view while a long page scrolls beside it (a window too short for the menu
 * scrolls the menu itself), 240 px wide, and folds to a 64 px strip of icons
 * to give the calendar and the boards the width. The choice outlives the page
 * in a cookie (`lib/sidebar-state.ts`), so the server draws the next page at
 * the same width. Below `md` the phone's top bar takes its place
 * (`mobile-nav.tsx`, decision 14).
 */
export function Sidebar({ email, isInitiallyCollapsed = false }: SidebarProps) {
  const { t } = useTranslation();
  const [isCollapsed, setIsCollapsed] = useState(isInitiallyCollapsed);
  const navId = useId();

  const toggle = () => {
    const next = !isCollapsed;
    setIsCollapsed(next);
    rememberSidebar(document, next ? 'collapsed' : 'expanded');
  };
  const toggleLabel = t(isCollapsed ? 'panel.nav.expand' : 'panel.nav.collapse');
  const ToggleIcon = isCollapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <aside
      data-state={isCollapsed ? 'collapsed' : 'expanded'}
      className={cn(
        'sticky top-0 hidden h-dvh shrink-0 flex-col self-start overflow-x-hidden overflow-y-auto border-r bg-card py-4 transition-[width] duration-200 ease-out motion-reduce:transition-none md:flex',
        isCollapsed ? 'w-16 px-2.5' : 'w-60 px-4',
      )}
    >
      <TooltipProvider>
        <Logo
          alt={t('panel.title')}
          variant={isCollapsed ? 'mark' : 'full'}
          className="mb-4 shrink-0"
        />
        <NavMenu id={navId} isCollapsed={isCollapsed} />
        <div className="mt-4 flex flex-col gap-2">
          <Separator />
          <StripTooltip
            label={toggleLabel}
            isCollapsed={isCollapsed}
            render={
              <button
                type="button"
                aria-expanded={!isCollapsed}
                aria-controls={navId}
                onClick={toggle}
                className={cn(navRowClass(isCollapsed), 'text-muted-foreground')}
              />
            }
          >
            <ToggleIcon
              className={cn('shrink-0', isCollapsed ? 'size-5' : 'size-4')}
              aria-hidden="true"
            />
            <span className={cn(isCollapsed && 'sr-only')}>{toggleLabel}</span>
          </StripTooltip>
          {isCollapsed ? null : (
            <span className="truncate text-xs text-muted-foreground" title={email}>
              {email}
            </span>
          )}
        </div>
      </TooltipProvider>
    </aside>
  );
}
