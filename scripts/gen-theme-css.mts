// Writes the panel's theme variables from the shared design tokens (5.2):
// `npm run design:css`, in the manner of `npm run db:types`.
//
// Runs under Node's type stripping (`--experimental-strip-types`, Node >= 22.6),
// so both modules are imported by path with their extension: the stripper
// resolves no workspace package and no extensionless import. The drift test
// (apps/web/src/lib/design/__tests__/theme-css.test.ts) renders the same CSS
// and fails while the committed file differs.

import { writeFileSync } from 'node:fs';

import { renderThemeCss } from '../apps/web/src/lib/design/theme-css.ts';
import {
  RADIUS,
  THEME_COLORS,
  TONE_COLORS,
  TONE_NAMES,
} from '../packages/shared/src/design/tokens.ts';

const OUT = 'apps/web/src/app/theme.generated.css';

const css = renderThemeCss({
  themes: THEME_COLORS,
  tones: TONE_COLORS,
  toneNames: TONE_NAMES,
  radius: RADIUS,
});

writeFileSync(OUT, css, 'utf8');
console.log(`${OUT} written (${css.length} bytes)`);
