'use client';

import { Switch as SwitchPrimitive } from '@base-ui/react/switch';
import { Moon, Sun } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { applyThemeChoice, onThemeChoice, shownThemeChoice, type ThemeChoice } from '@/lib/theme';
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
  // Drawn anew (the menu folded), it shows the choice made since, not the page's first.
  const [choice, setChoice] = useState<ThemeChoice>(() =>
    typeof document === 'undefined' ? initial : shownThemeChoice(document, initial),
  );
  const systemIsDark = useSystemIsDark();
  const isDark = choice === 'dark' || (choice === 'system' && systemIsDark);
  const label = t('panel.nav.darkMode');

  // It slides only once the theme is moved: a lever that flips into place as
  // the page wakes (as the system, at night) is not to glide across each load.
  const [isMoving, setMoving] = useState(false);

  useEffect(
    () =>
      onThemeChoice(document, (next) => {
        setMoving(true);
        setChoice(next);
      }),
    [],
  );

  const lever = (
    <SwitchPrimitive.Root
      checked={isDark}
      onCheckedChange={(next) => applyThemeChoice(document, next ? 'dark' : 'light')}
      aria-label={label}
      className={cn(
        'group/lever relative inline-flex shrink-0 cursor-pointer items-center rounded-full border border-border p-0.5 shadow-inner outline-none',
        isMoving && 'transition-colors duration-300 ease-out motion-reduce:transition-none',
        'focus-visible:ring-3 focus-visible:ring-ring/50',
        // Day: a warm, light track; night: the brand colour.
        'data-unchecked:bg-accent data-checked:bg-primary',
        // A third smaller than the first lever (the owner, 10.10), the same in
        // the menu and the folded strip: 22×38.
        'h-5.5 w-9.5',
        // A gloved finger's target, 46×46, wider than the lever it moves.
        'after:absolute after:-inset-x-1 after:-inset-y-3',
      )}
    >
      <Sun
        aria-hidden="true"
        className="absolute left-1 size-2.5 text-primary-foreground transition-opacity group-data-checked/lever:opacity-80 group-data-unchecked/lever:opacity-0"
      />
      <Moon
        aria-hidden="true"
        className="absolute right-1 size-2.5 text-muted-foreground transition-opacity group-data-checked/lever:opacity-0 group-data-unchecked/lever:opacity-80"
      />
      <SwitchPrimitive.Thumb
        data-slot="theme-lever-knob"
        className={cn(
          'pointer-events-none relative z-10 flex items-center justify-center rounded-full bg-background shadow-md ring-1 ring-border',
          isMoving && 'transition-transform duration-300 ease-out motion-reduce:transition-none',
          // Its travel: the track inside its border and padding (32), less the knob (18).
          'size-4.5 data-checked:translate-x-3.5',
        )}
      >
        {isDark ? (
          <Moon aria-hidden="true" className="size-2.5 text-primary" />
        ) : (
          <Sun aria-hidden="true" className="size-2.5 text-primary" />
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
