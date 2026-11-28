import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { i18n } from '@/lib/i18n';

import { DayDivider, dayDividerText } from './day-divider';

const TODAY = '2026-11-27';

describe('dayDividerText', () => {
  test.each([
    ['ru', '2026-11-27', 'Сегодня · пт 27.11', 'Сегодня, пятница, 27 ноября'],
    ['ru', '2026-11-28', 'Завтра · сб 28.11', 'Завтра, суббота, 28 ноября'],
    ['ru', '2026-11-29', 'вс 29.11', 'воскресенье, 29 ноября'],
    ['ru', '2026-11-26', 'чт 26.11', 'четверг, 26 ноября'],
    ['en', '2026-11-27', 'Today · Fri 27/11', 'Today, Friday 27 November'],
    ['en', '2026-11-28', 'Tomorrow · Sat 28/11', 'Tomorrow, Saturday 28 November'],
    ['cs', '2026-11-27', 'Dnes · pá 27. 11.', 'Dnes, pátek 27. listopadu'],
    ['cs', '2026-11-26', 'čt 26. 11.', 'čtvrtek 26. listopadu'],
  ] as const)('%s %s reads «%s»', (language, day, shown, spoken) => {
    expect(dayDividerText(day, TODAY, language, i18n.getFixedT(language))).toEqual({
      shown,
      spoken,
    });
  });

  test('says the year only when it is not this one', () => {
    const t = i18n.getFixedT('ru');
    expect(dayDividerText('2025-10-25', TODAY, 'ru', t).shown).toBe('сб 25.10.2025');
    expect(dayDividerText('2027-01-04', TODAY, 'ru', t).shown).toBe('пн 04.01.2027');
  });
});

describe('DayDivider', () => {
  test('is a heading a screen reader hears in full, the short words hidden from it', () => {
    render(<DayDivider day="2026-11-28" today={TODAY} />);

    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading).toHaveAccessibleName('Завтра, суббота, 28 ноября');
    expect(screen.getByText('Завтра · сб 28.11')).toHaveAttribute('aria-hidden', 'true');
  });

  test('is small, muted and plain: no weight, no frame, no fill', () => {
    render(<DayDivider day={TODAY} today={TODAY} />);

    const heading = screen.getByRole('heading');
    expect(heading).toHaveClass('text-xs', 'font-normal', 'text-muted-foreground');
    const divider = heading.parentElement as HTMLElement;
    expect(divider.className).not.toMatch(/\b(border|bg-|rounded|shadow)/);
  });

  test('draws a hairline in the border’s tone to the end of the row, hidden from a reader', () => {
    render(<DayDivider day={TODAY} today={TODAY} />);

    const line = screen.getByRole('heading').nextElementSibling as HTMLElement;
    expect(line).toHaveAttribute('aria-hidden', 'true');
    expect(line).toHaveClass('h-px', 'flex-1', 'bg-border');
  });

  test('takes no pointer and no focus: a drag and a click are its list’s', () => {
    render(<DayDivider day={TODAY} today={TODAY} />);

    const divider = screen.getByRole('heading').parentElement as HTMLElement;
    expect(divider).toHaveClass('pointer-events-none', 'select-none');
    // Holds its screen-reader words (placed absolutely): in a scrolling column they stay inside it.
    expect(divider).toHaveClass('relative');
    expect(divider.querySelector('.sr-only')?.parentElement?.parentElement).toBe(divider);
    expect(divider.querySelector('[tabindex], a, button')).toBeNull();
    expect(divider).not.toHaveAttribute('draggable');
  });

  test('has room above it, but none when it opens its list', () => {
    render(<DayDivider day={TODAY} today={TODAY} />);

    expect(screen.getByRole('heading').parentElement).toHaveClass('pt-2', 'first:pt-0');
  });

  // Owner, 2026-11-28: a manager board's cards with no due date stand last, under a line of theirs.
  test('heads the items with no date by the words it is given, the same line otherwise', () => {
    render(<DayDivider day={null} label="Без срока" />);

    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading).toHaveAccessibleName('Без срока');
    expect(heading).toHaveClass('text-xs', 'font-normal', 'text-muted-foreground');
    expect(heading.parentElement).toHaveClass('pointer-events-none', 'relative');
    expect(heading.nextElementSibling).toHaveClass('h-px', 'flex-1', 'bg-border');
  });

  test('may stand a level lower, under a section’s heading', () => {
    render(<DayDivider day={TODAY} today={TODAY} level={3} />);

    expect(screen.getByRole('heading', { level: 3 })).toBeInTheDocument();
  });
});
