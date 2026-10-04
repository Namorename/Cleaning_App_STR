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

const PICTURE_CLASS = 'size-full object-contain object-left';

interface LogoProps {
  /** The panel's name in the manager's language (`panel.title`). */
  alt: string;
  className?: string;
}

/**
 * The company's logo in a 192×48 frame (as wide as the menu inside its
 * padding): a picture of any shape fits whole, at the left edge — 4:1 fills
 * it, a square stands 48×48. The owner swaps the files, not this code.
 *
 * Two pictures, one per theme, behind the same `dark` variant that paints the
 * panel (globals.css) — `<picture>` with `prefers-color-scheme` would follow
 * the system even when the manager chose otherwise in «Настройки». The hidden
 * one is `display: none`, out of the accessibility tree, so a screen reader
 * meets one logo with its text.
 */
export function Logo({ alt, className }: LogoProps) {
  return (
    <div className={cn('h-12 w-full', className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a vector in public/, nothing to optimise */}
      <img src={LOGO_SOURCES.light} alt={alt} className={cn(PICTURE_CLASS, 'dark:hidden')} />
      {/* eslint-disable-next-line @next/next/no-img-element -- a vector in public/, nothing to optimise */}
      <img src={LOGO_SOURCES.dark} alt={alt} className={cn(PICTURE_CLASS, 'hidden dark:block')} />
    </div>
  );
}
