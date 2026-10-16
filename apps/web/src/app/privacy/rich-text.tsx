import { Fragment, type ReactNode } from 'react';

/** The two marks a policy sentence may carry: `<b>…</b>` (not nested) and `{{name}}`. */
const MARK = /<b>(.*?)<\/b>|\{\{(\w+)\}\}/g;

export type Slots = Readonly<Record<string, ReactNode>>;

function slotValue(name: string, slots: Slots): ReactNode {
  if (!Object.hasOwn(slots, name)) {
    throw new Error(`No value for {{${name}}}`);
  }
  return slots[name];
}

/**
 * A sentence of the privacy policy, from the shared locales, as React nodes.
 *
 * The draft sets some words in bold inside a sentence, and the page puts
 * values, links and placeholders into others; a translation must be free to
 * move both, so they live in the sentence itself. Only these two marks are
 * read — any other `<` is text — and nothing is ever set as HTML. A slot the
 * caller did not give throws: every language is rendered by the tests, and a
 * printed `{{date}}` would be a page that says nothing.
 */
export function renderRich(template: string, slots: Slots = {}): ReactNode[] {
  const nodes: ReactNode[] = [];
  let rest = 0;
  for (const match of template.matchAll(MARK)) {
    const [whole, bold, slot] = match;
    const at = match.index ?? 0;
    if (at > rest) {
      nodes.push(template.slice(rest, at));
    }
    nodes.push(
      bold === undefined ? (
        <Fragment key={at}>{slotValue(slot, slots)}</Fragment>
      ) : (
        <strong key={at}>{renderRich(bold, slots)}</strong>
      ),
    );
    rest = at + whole.length;
  }
  if (rest < template.length) {
    nodes.push(template.slice(rest));
  }
  return nodes;
}
