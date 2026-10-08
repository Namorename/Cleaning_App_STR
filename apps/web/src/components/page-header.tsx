import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface PageBack {
  href: string;
  /** The words only: the arrow is drawn (`ICONS['action.back']`). */
  label: string;
}

interface PageHeaderProps {
  /** The page's name: its one h1. */
  title: ReactNode;
  /** Beside the title — a status, a count — what describes it. */
  meta?: ReactNode;
  /** Under the title, quieter. */
  description?: ReactNode;
  /** At the right of the title; under it on a narrow screen. */
  actions?: ReactNode;
  /** Above the title, for a page that is one entry of a list. */
  back?: PageBack;
  className?: string;
}

/**
 * The head of every panel page (the owner's shell, variant A of
 * docs/design/decisions.md §2): the way back, the title with what describes
 * it, the page's actions at the right, a line under it.
 *
 * The only place a page's h1 is written, so every page has exactly one and
 * the actions always stand in the same place. No hooks and no translations:
 * the words come in as props, and a server page (404) can use it as a client
 * view does.
 */
export function PageHeader({
  title,
  meta,
  description,
  actions,
  back,
  className,
}: PageHeaderProps) {
  return (
    <header data-slot="page-header" className={cn('flex flex-col gap-1', className)}>
      {back === undefined ? null : <PageBackLink {...back} />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-2xl font-semibold break-words">{title}</h1>
          {meta}
        </div>
        {actions === undefined ? null : (
          <div data-slot="page-actions" className="flex flex-wrap items-center gap-2">
            {actions}
          </div>
        )}
      </div>
      {description === undefined ? null : (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
    </header>
  );
}

/**
 * The way back to the list a page belongs to; on its own while the page's
 * title is still loading or was not found.
 */
export function PageBackLink({ href, label }: PageBack) {
  return (
    <Link
      href={href}
      className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground hover:underline"
    >
      <ChevronLeft className="size-4 shrink-0" aria-hidden="true" />
      {label}
    </Link>
  );
}
