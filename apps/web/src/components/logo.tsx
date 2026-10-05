import { cn } from '@/lib/utils';

/**
 * The files' format, the one thing to change for a raster logo: the owner's
 * PNGs go in as `logo-light@2x.png` and `logo-dark@2x.png`, at least 384×96
 * (docs/redesign-plan.md, 6.1).
 */
const LOGO_EXTENSION = '.svg';

/** Dark marks for the light theme, light marks for the dark one; served from `public/`. */
export const LOGO_SOURCES = {
  light: `/brand/logo-light${LOGO_EXTENSION}`,
  dark: `/brand/logo-dark${LOGO_EXTENSION}`,
} as const;

/**
 * The mark without the word, for the menu folded to a strip of icons and the
 * phone's top bar: the same sketch cut to a square. The owner's mark replaces
 * these two files the same way.
 */
export const LOGO_MARK_SOURCES = {
  light: `/brand/logo-mark-light${LOGO_EXTENSION}`,
  dark: `/brand/logo-mark-dark${LOGO_EXTENSION}`,
} as const;

type LogoVariant = 'full' | 'mark';

const SOURCES: Record<LogoVariant, { light: string; dark: string }> = {
  full: LOGO_SOURCES,
  mark: LOGO_MARK_SOURCES,
};

/** The full logo's frame is the menu's width; the mark's is a strip row, 44 px. */
const FRAME_CLASS: Record<LogoVariant, string> = {
  full: 'h-12 w-full',
  mark: 'size-11',
};

const PICTURE_CLASS: Record<LogoVariant, string> = {
  full: 'size-full object-contain object-left',
  mark: 'size-full object-contain object-center',
};

interface LogoProps {
  /** The panel's name in the manager's language (`panel.title`). */
  alt: string;
  /** The full logo (default), or its mark alone. */
  variant?: LogoVariant;
  className?: string;
}

/**
 * The company's logo in a 192×48 frame (as wide as the menu inside its
 * padding): a picture of any shape fits whole, at the left edge — 4:1 fills
 * it, a square stands 48×48. The mark alone fits a 44×44 square, centred. The
 * owner swaps the files, not this code.
 *
 * Two pictures, one per theme, behind the same `dark` variant that paints the
 * panel (globals.css) — `<picture>` with `prefers-color-scheme` would follow
 * the system even when the manager chose otherwise in «Настройки». The hidden
 * one is `display: none`, out of the accessibility tree, so a screen reader
 * meets one logo with its text.
 */
export function Logo({ alt, variant = 'full', className }: LogoProps) {
  const sources = SOURCES[variant];
  const picture = PICTURE_CLASS[variant];

  return (
    <div className={cn(FRAME_CLASS[variant], className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a vector in public/, nothing to optimise */}
      <img src={sources.light} alt={alt} className={cn(picture, 'dark:hidden')} />
      {/* eslint-disable-next-line @next/next/no-img-element -- a vector in public/, nothing to optimise */}
      <img src={sources.dark} alt={alt} className={cn(picture, 'hidden dark:block')} />
    </div>
  );
}
