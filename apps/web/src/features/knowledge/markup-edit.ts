import { KB_MARKS } from '@str-ops/shared';

/** What a button of the text puts in: one of the marks the reader takes. */
export type MarkKind = 'bold' | 'bullet' | 'numbered' | 'step' | 'important' | 'link';

export interface Edited {
  text: string;
  /** Where the selection is after the edit. */
  start: number;
  end: number;
}

type LineMark = Exclude<MarkKind, 'bold' | 'link'>;

/** A line that already starts with the mark keeps it as it is. */
const CARRIES: Record<LineMark, RegExp> = {
  bullet: /^[-*] /,
  numbered: /^\d{1,3}\. /,
  step: /^\d{1,3}\) /,
  important: /^> ?/,
};

function prefixOf(mark: LineMark, position: number): string {
  if (mark === 'numbered') {
    return `${position}. `;
  }
  if (mark === 'step') {
    return `${position}) `;
  }
  return KB_MARKS[mark];
}

/** A mark at the start of every line the selection touches, numbered from one. */
function markLines(text: string, start: number, end: number, mark: LineMark): Edited {
  // lastIndexOf clamps a negative start to 0 and would find a break there.
  const firstLine = start === 0 ? 0 : text.lastIndexOf('\n', start - 1) + 1;
  // A selection that ends right after a line break does not reach the next line.
  const lastReach = end > start && text[end - 1] === '\n' ? end - 1 : end;
  const nextBreak = text.indexOf('\n', lastReach);
  const lastLine = nextBreak === -1 ? text.length : nextBreak;

  const lines = text.slice(firstLine, lastLine).split('\n');
  let at = firstLine;
  let shiftStart = 0;
  let shiftEnd = 0;
  const marked = lines.map((line, index) => {
    const lineStart = at;
    at += line.length + 1;
    if (CARRIES[mark].test(line)) {
      return line;
    }
    const prefix = prefixOf(mark, index + 1);
    if (lineStart < start) {
      shiftStart += prefix.length;
    }
    if (lineStart < end || (lineStart === end && start === end)) {
      shiftEnd += prefix.length;
    }
    return `${prefix}${line}`;
  });

  return {
    text: `${text.slice(0, firstLine)}${marked.join('\n')}${text.slice(lastLine)}`,
    start: start + shiftStart,
    end: end + shiftEnd,
  };
}

/**
 * The text with a mark applied to the selection, `start`..`end`: bold around
 * it, a link made of it (the caret left after `https://` for the address), or
 * a line mark on every line it touches.
 */
export function applyMark(
  text: string,
  start: number,
  end: number,
  mark: MarkKind,
  linkText: string,
): Edited {
  const selected = text.slice(start, end);

  if (mark === 'bold') {
    const stars = KB_MARKS.bold;
    return {
      text: `${text.slice(0, start)}${stars}${selected}${stars}${text.slice(end)}`,
      start: start + stars.length,
      end: end + stars.length,
    };
  }

  if (mark === 'link') {
    const head = `[${selected === '' ? linkText : selected}](https://`;
    const caret = start + head.length;
    return { text: `${text.slice(0, start)}${head})${text.slice(end)}`, start: caret, end: caret };
  }

  return markLines(text, start, end, mark);
}
