'use client';

import { STATUS_TONE } from '@str-ops/shared';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';

/** «Новое сообщение»: somebody said something the manager has not read. */
export function UnreadBadge() {
  const { t } = useTranslation();
  return <Badge tone={STATUS_TONE['chat.unread']}>{t('panel.chat.unread')}</Badge>;
}

/** The badge's look kept, the press a 44 px target around it (TOUCH_TARGET.panelMin). */
const PRESSABLE =
  'inline-flex min-h-11 shrink-0 items-center rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50';

interface UnreadChatLinkProps {
  href: string;
  /**
   * Whose conversation: said in the mark's name, so a reader listing the links
   * of a list hears one per subject, not «открыть разговор» over and over.
   */
  about: string;
}

/**
 * The mark in a list as the way into the conversation (5.4, «Чат», variant
 * B): a link to the page that opens it — a task's page with `chat=1`.
 */
export function UnreadChatLink({ href, about }: UnreadChatLinkProps) {
  const { t } = useTranslation();
  return (
    <Link href={href} aria-label={t('panel.chat.openUnread', { about })} className={PRESSABLE}>
      <UnreadBadge />
    </Link>
  );
}

interface UnreadChatButtonProps {
  onOpen: () => void;
  /** Whose conversation, said in the mark's name (as on the link). */
  about: string;
}

/** The mark as a button that opens the conversation where the list is. */
export function UnreadChatButton({ onOpen, about }: UnreadChatButtonProps) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      aria-label={t('panel.chat.openUnread', { about })}
      className={PRESSABLE}
      onClick={onOpen}
    >
      <UnreadBadge />
    </button>
  );
}
