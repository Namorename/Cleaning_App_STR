import { splitLinks } from '@str-ops/shared';

import { cn } from '@/lib/utils';

interface LinkedTextProps {
  text: string;
  className?: string;
}

/**
 * A card's words as they were typed — line breaks kept — with every
 * `http(s)://` link one to open, in a new tab and without handing it this
 * page (`noopener noreferrer`). Nothing else is read as markup: the text is
 * React's text, never HTML.
 */
export function LinkedText({ text, className }: LinkedTextProps) {
  return (
    <p className={cn('break-words whitespace-pre-wrap', className)}>
      {splitLinks(text).map((part, index) =>
        part.kind === 'link' ? (
          <a
            key={index}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2 hover:no-underline"
          >
            {part.text}
          </a>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </p>
  );
}
