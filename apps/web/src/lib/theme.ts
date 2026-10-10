import { yearCookie } from './cookie';

/**
 * The panel's theme (decision 6 of docs/design/decisions.md): as the system,
 * light or dark, chosen in «Настройки».
 *
 * The choice lives in a cookie, like the language (`lib/language.ts`), so the
 * server renders <html> with `light` or `dark` already on it and the first
 * paint is in the right colours. «As the system» puts no class at all: the
 * stylesheet follows `prefers-color-scheme` while <html> is not `.light`
 * (`theme.generated.css`, the `dark` variant in `globals.css`) — no script
 * runs before the paint, and an OS switching to dark at dusk repaints an open
 * panel by itself. Free of any React binding: the root layout imports it.
 */
export const THEME_COOKIE = 'theme';

export const THEME_CHOICES = ['system', 'light', 'dark'] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

export const DEFAULT_THEME: ThemeChoice = 'system';

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return THEME_CHOICES.includes(value as ThemeChoice);
}

export function themeFromCookie(value: string | undefined): ThemeChoice {
  return isThemeChoice(value) ? value : DEFAULT_THEME;
}

/** The class the server puts on <html>: none while the system decides. */
export function themeClass(choice: ThemeChoice): 'light' | 'dark' | undefined {
  return choice === 'system' ? undefined : choice;
}

/** The cookie as `document.cookie` takes it: the whole panel, for a year. */
export function themeCookie(choice: ThemeChoice, isSecure: boolean): string {
  return yearCookie(THEME_COOKIE, choice, isSecure);
}

/**
 * Said on the document whenever the choice changes: the lever in the menu and
 * the choice in «Настройки» are one setting, and each shows what the other did
 * (night of 2026-10-10).
 */
const THEME_EVENT = 'str-ops:theme';

/**
 * The choice in the browser: <html> takes its class at once, and the cookie
 * tells the server for every page after. A later render of the root layout
 * reads the same cookie, so React and this function never disagree.
 */
export function applyThemeChoice(doc: Document, choice: ThemeChoice): void {
  const root = doc.documentElement;
  root.classList.remove('light', 'dark');
  const name = themeClass(choice);
  if (name !== undefined) {
    root.classList.add(name);
  }
  doc.cookie = themeCookie(choice, doc.location?.protocol === 'https:');
  doc.dispatchEvent(new CustomEvent<ThemeChoice>(THEME_EVENT, { detail: choice }));
}

/** Hear every change of the choice, wherever it is made. Returns the way to stop. */
export function onThemeChoice(doc: Document, listener: (choice: ThemeChoice) => void): () => void {
  const heard = (event: Event) => {
    const { detail } = event as CustomEvent<unknown>;
    if (isThemeChoice(detail)) {
      listener(detail);
    }
  };
  doc.addEventListener(THEME_EVENT, heard);
  return () => doc.removeEventListener(THEME_EVENT, heard);
}
