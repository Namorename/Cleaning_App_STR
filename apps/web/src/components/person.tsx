'use client';

import { Briefcase, ShieldCheck, SprayCan, User, Wrench, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

/**
 * The icon that says what somebody does.
 *
 * A schedule is read at a glance, and a name alone does not say whether the
 * person on a job is the one who cleans it or the one who fixes it. The icon
 * carries that; the role is also written out for a screen reader and in the
 * tooltip, because an icon on its own is a guess.
 */
const ROLE_ICONS: Record<string, LucideIcon> = {
  cleaner: SprayCan,
  tech: Wrench,
  manager: Briefcase,
  admin: ShieldCheck,
};

interface PersonProps {
  /** Their name; null when the row carries none. */
  name: string | null | undefined;
  /** One of `app_role`. Unknown or missing falls back to a plain person. */
  role?: string | null;
  /** Shown in place of a name — "nobody yet", and the like. */
  fallback?: string;
  className?: string;
}

/** A person as the panel shows them everywhere: the icon of their role, then their name. */
export function Person({ name, role, fallback, className }: PersonProps) {
  const { t } = useTranslation();
  const isKnownRole = role != null && role in ROLE_ICONS;
  const Icon = isKnownRole ? ROLE_ICONS[role] : User;
  const roleLabel = t(isKnownRole ? `panel.roles.${role}` : 'panel.roles.unknown');

  return (
    <span className={cn('inline-flex items-center gap-1', className)} title={roleLabel}>
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">{roleLabel}: </span>
      {name ?? fallback ?? ''}
    </span>
  );
}
