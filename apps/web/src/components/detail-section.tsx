import { useId, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface DetailSectionProps {
  /** The section's name: small, muted and in capitals, so it never competes with what it names. */
  title: ReactNode;
  /** A lever beside the name («Изменить»), at the far end of its line. */
  action?: ReactNode;
  /** The heading's level: h2 under a page's h1, h4 inside a card headed by an h3. */
  level?: 2 | 3 | 4;
  className?: string;
  children: ReactNode;
}

/**
 * One block of a detail view — «Описание», «Фото», «Гость и проживание» (owner, 2026-11-19: the
 * text blended in). The name is a quiet label and the content under it reads in the full colour,
 * so the eye finds the sections by their labels and the facts by their weight.
 */
export function DetailSection({
  title,
  action,
  level = 2,
  className,
  children,
}: DetailSectionProps) {
  const headingId = useId();
  const Heading = `h${level}` as const;

  return (
    <section aria-labelledby={headingId} className={cn('flex flex-col gap-2', className)}>
      <div className="flex min-h-6 items-center justify-between gap-2">
        <Heading
          id={headingId}
          className="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
        >
          {title}
        </Heading>
        {action}
      </div>
      {children}
    </section>
  );
}
