/**
 * A licence as a phone can show it.
 *
 * Licence files are wrapped by hand at about 70 characters, and on a phone
 * every such line wraps again, leaving a ragged half-empty line after each.
 * So the text is cut into blocks: paragraphs flow (their lines joined), a
 * section name in capitals is a heading, and a line of dashes is a rule. Only
 * the layout changes — every word stays, in order.
 */

export type LicenseBlock =
  | { readonly kind: 'heading'; readonly text: string }
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'rule' };

const RULE = /^-{3,}$/;
/** A section name is a short line with no lowercase letter: PREAMBLE, DISCLAIMER. */
const HEADING_MAX_LENGTH = 40;

function isSectionName(line: string): boolean {
  return line.length <= HEADING_MAX_LENGTH && /[A-Z]/.test(line) && line === line.toUpperCase();
}

function blocksOf(paragraph: string): LicenseBlock[] {
  const lines = paragraph.split('\n').map((line) => line.trim());

  // A title boxed between rules: the rules stay rules, what they box is a heading.
  if (lines.some((line) => RULE.test(line))) {
    return lines.map(
      (line): LicenseBlock =>
        RULE.test(line) ? { kind: 'rule' } : { kind: 'heading', text: line },
    );
  }

  const [first, ...rest] = lines;
  if (rest.length > 0 && isSectionName(first)) {
    return [
      { kind: 'heading', text: first },
      { kind: 'paragraph', text: rest.join(' ') },
    ];
  }
  return [{ kind: 'paragraph', text: lines.join(' ') }];
}

export function licenseBlocks(text: string): LicenseBlock[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '')
    .flatMap(blocksOf);
}
