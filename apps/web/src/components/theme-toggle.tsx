'use client';

import { Switch as SwitchPrimitive } from '@base-ui/react/switch';
import { Moon, Sun } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { applyThemeChoice, onThemeChoice, type ThemeChoice } from '@/lib/theme';
import { cn } from '@/lib/utils';

interface ThemeToggleProps {
  /** The choice the server read from the cookie. */
  initial: ThemeChoice;
  /** In the folded strip: the lever alone, its name for the reader only. */
  isCompact?: boolean;
}

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Whether the system is dark now, heard as it changes at dusk; false where it cannot say. */
function useSystemIsDark(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia?.(DARK_QUERY);
      media?.addEventListener('change', onChange);
      return () => media?.removeEventListener('change', onChange);
    },
    () => window.matchMedia?.(DARK_QUERY).matches ?? false,
    () => false,
  );
}

/**
 * The day and the night theme a press away, in the menu (the owner's word,
 * night of 2026-10-10): a lever — the sun on the day side, the moon on the
 * night side, the knob carrying the one in force. It shows the theme the
 * panel is in now: «as the system» stands where the system stands. A press
 * chooses the other theme outright, the same choice «Настройки» make
 * (decision 6), kept in the cookie for every page after; the two hear each
 * other (`onThemeChoice`).
 */
export function ThemeToggle({ initial, isCompact = false }: ThemeToggleProps) {
  const { t } = useTranslation();
  const [choice, setChoice] = useState<ThemeChoice>(initial);
  const systemIsDark = useSystemIsDark();
  const isDark = choice === 'dark' || (choice === 'system' && systemIsDark);
  const label = t('panel.nav.darkMode');

  useEffect(() => onThemeChoice(document, setChoice), []);

  const lever = (
    <SwitchPrimitive.Root
      checked={isDark}
      onCheckedChange={(next) => applyThemeChoice(document, next ? 'dark' : 'light')}
      aria-label={label}
      className={cn(
        'group/lever relative inline-flex shrink-0 cursor-pointer items-center rounded-full border border-border p-0.5 shadow-inner outline-none',
        'transition-colors duration-300 ease-out motion-reduce:transition-none',
        'focus-visible:ring-3 focus-visible:ring-ring/50',
        'data-unchecked:bg-muted data-checked:bg-primary',
        // A gloved finger's target, wider than the lever it moves.
        'after:absolute after:-inset-x-1 after:-inset-y-2.5',
        isCompact ? 'h-6 w-11' : 'h-8 w-14',
      )}
    >
      <Sun
        aria-hidden="true"
        className={cn(
          'absolute text-muted-foreground transition-opacity group-data-checked/lever:opacity-60 group-data-unchecked/lever:opacity-0',
          isCompact ? 'left-1 size-3' : 'left-1.5 size-4',
        )}
      />
      <Moon
        aria-hidden="true"
        className={cn(
          'absolute text-muted-foreground transition-opacity group-data-checked/lever:opacity-0 group-data-unchecked/lever:opacity-60',
          isCompact ? 'right-1 size-3' : 'right-1.5 size-4',
        )}
      />
      <SwitchPrimitive.Thumb
        data-slot="theme-lever-knob"
        className={cn(
          'pointer-events-none relative z-10 flex items-center justify-center rounded-full bg-background shadow-md ring-1 ring-border',
          'transition-transform duration-300 ease-out motion-reduce:transition-none',
          isCompact ? 'size-5 data-checked:translate-x-5' : 'size-7 data-checked:translate-x-6',
        )}
      >
        {isDark ? (
          <Moon
            aria-hidden="true"
            className={cn('text-primary', isCompact ? 'size-3' : 'size-4')}
          />
        ) : (
          <Sun aria-hidden="true" className={cn('text-primary', isCompact ? 'size-3' : 'size-4')} />
        )}
      </SwitchPrimitive.Thumb>
    </SwitchPrimitive.Root>
  );

  if (isCompact) {
    return lever;
  }

  return (
    <div className="flex min-h-11 items-center justify-between gap-3 px-3 text-sm">
      <span aria-hidden="true">{label}</span>
      {lever}
    </div>
  );
}
