import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// A plain anchor: Next's own link would ask for the app router, which a test
// has not got. Under test is what this link does with a press before it.
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: ComponentProps<'a'>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { InPlaceLink } from './in-place-link';

const onOpen = vi.fn();
/** Whether the page kept the press from the browser, seen last on its way up. */
let wasPrevented: boolean | null = null;
const watch = (event: Event) => {
  wasPrevented = event.defaultPrevented;
  // jsdom cannot follow a link; the test stops it after looking.
  event.preventDefault();
};

beforeEach(() => {
  vi.clearAllMocks();
  wasPrevented = null;
  document.addEventListener('click', watch);
});

afterEach(() => {
  document.removeEventListener('click', watch);
});

const link = () => screen.getByRole('link', { name: 'Karlín 3' });

describe('InPlaceLink', () => {
  test('is a real address, with what the caller put on it', () => {
    render(
      <InPlaceLink href="/supplies?request=5" className="row" data-request-link="5" onOpen={onOpen}>
        Karlín 3
      </InPlaceLink>,
    );

    expect(link()).toHaveAttribute('href', '/supplies?request=5');
    expect(link()).toHaveClass('row');
    expect(link()).toHaveAttribute('data-request-link', '5');
  });

  test('a plain press opens the entry in place and keeps the browser from leaving', () => {
    render(
      <InPlaceLink href="/supplies?request=5" onOpen={onOpen}>
        Karlín 3
      </InPlaceLink>,
    );

    fireEvent.click(link());

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(wasPrevented).toBe(true);
  });

  test.each([
    ['Ctrl', { ctrlKey: true }],
    ['Cmd', { metaKey: true }],
    ['Shift', { shiftKey: true }],
    ['Alt', { altKey: true }],
    ['the middle button', { button: 1 }],
  ])('a press with %s is left to the browser', (_how, init) => {
    render(
      <InPlaceLink href="/supplies?request=5" onOpen={onOpen}>
        Karlín 3
      </InPlaceLink>,
    );

    fireEvent.click(link(), init);

    expect(onOpen).not.toHaveBeenCalled();
    expect(wasPrevented).toBe(false);
  });

  test('without a way to open in place, a press navigates', () => {
    render(<InPlaceLink href="/apartments?listing=101">Karlín 3</InPlaceLink>);

    fireEvent.click(link());

    expect(wasPrevented).toBe(false);
  });

  test('the link to the open entry says so, and only that one', () => {
    render(
      <>
        <InPlaceLink href="/supplies?request=5" isCurrent onOpen={onOpen}>
          Karlín 3
        </InPlaceLink>
        <InPlaceLink href="/supplies?request=6" onOpen={onOpen}>
          Smíchov 8
        </InPlaceLink>
      </>,
    );

    expect(link()).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('link', { name: 'Smíchov 8' })).not.toHaveAttribute('aria-current');
  });

  // A submenu's links are pages of their own (the sections of «Настройки»):
  // a screen reader says «current page», not just «current».
  test('a link of a submenu is marked as the current page', () => {
    render(
      <InPlaceLink href="/settings?section=company" isCurrent currentAs="page" onOpen={onOpen}>
        Karlín 3
      </InPlaceLink>,
    );

    expect(link()).toHaveAttribute('aria-current', 'page');
  });
});
