'use client';

import { Menu } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Logo } from '@/components/logo';
import { NavMenu } from '@/components/nav-menu';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useUnreadSubjects } from '@/features/chat/use-chat';

interface MobileNavProps {
  email: string;
}

/**
 * The panel on a phone (the owner's decision 14): below `md` the side menu
 * gives its width to the page, and this bar takes its place — the logo's mark
 * and a button that opens the same menu in a sheet from the left.
 *
 * The sheet is a modal dialog: the focus moves into it, Escape and «Закрыть»
 * close it and give the focus back to the button, and choosing a section
 * closes it as well. A dot on the closed button says a conversation waits;
 * the counts themselves are on the sections inside.
 */
export function MobileNav({ email }: MobileNavProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const unread = useUnreadSubjects();
  const waiting = unread.tasks.size + unread.problems.size;

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b bg-card px-2 md:hidden">
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetTrigger className="relative inline-flex size-11 items-center justify-center rounded-md hover:bg-accent">
          <Menu className="size-5" aria-hidden="true" />
          <span className="sr-only">{t('panel.nav.open')}</span>
          {waiting > 0 ? (
            <>
              <span
                aria-hidden="true"
                className="absolute top-2 right-2 size-2 rounded-full bg-primary"
              />
              <span className="sr-only">{t('panel.nav.unread', { count: waiting })}</span>
            </>
          ) : null}
        </SheetTrigger>
        <SheetContent
          side="left"
          className="max-w-[85vw] overflow-y-auto p-4 data-[side=left]:w-72"
        >
          <SheetTitle className="sr-only">{t('panel.nav.label')}</SheetTitle>
          <Logo alt={t('panel.title')} className="h-10 shrink-0" />
          <NavMenu onNavigate={() => setIsOpen(false)} />
          <span className="truncate text-xs text-muted-foreground" title={email}>
            {email}
          </span>
        </SheetContent>
      </Sheet>
      <Logo alt={t('panel.title')} variant="mark" className="size-9" />
    </header>
  );
}
