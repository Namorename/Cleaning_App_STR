import { fireEvent, render, screen } from '@testing-library/react';
import Link from 'next/link';
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';

import { useLeaveGuard } from '../use-leave-guard';

const QUESTION = 'Leave and lose the changes?';

interface HarnessProps {
  isActive: boolean;
  /** The question, in the panel's language of the moment. */
  message?: string;
  /** Next's Link handled the press: it would move the address there. */
  onFollow: (href: string) => void;
  /** What the screen's own way out was told. */
  onBack: (mayLeave: boolean) => void;
}

/** Links of every kind the panel draws, and a «Back» of the screen's own. */
function Harness({ isActive, message = QUESTION, onFollow, onBack }: HarnessProps) {
  const confirmLeave = useLeaveGuard(isActive, message);
  // Link's own click handler runs this first, then moves the address; held
  // here, as a test has no router.
  const follow = (href: string) => (event: { preventDefault: () => void }) => {
    event.preventDefault();
    onFollow(href);
  };
  return (
    <>
      <Link href="/tasks" onClick={follow('/tasks')}>
        Cleanings
      </Link>
      <Link href="/knowledge?status=archived" onClick={follow('/knowledge?status=archived')}>
        <span>The archive</span>
      </Link>
      <Link href="/tasks" target="_self" onClick={follow('/tasks')}>
        Cleanings in this tab
      </Link>
      <a href="/tasks" target="_blank">
        Cleanings in a new tab
      </a>
      <a href="/report.csv" download>
        The report as a file
      </a>
      <a href="https://example.com/help">Help elsewhere</a>
      <a href="mailto:office@example.com">Write to the office</a>
      <a href="#history">Down the page</a>
      <button type="button" onClick={() => onBack(confirmLeave())}>
        Back
      </button>
    </>
  );
}

/**
 * The browser, last to hear of a press: what the panel let through goes no
 * further than jsdom's location, which cannot navigate.
 */
const browser = (event: Event) => event.preventDefault();

const onFollow = vi.fn();
const onBack = vi.fn();
const draw = (isActive: boolean, message?: string) => (
  <Harness isActive={isActive} message={message} onFollow={onFollow} onBack={onBack} />
);
const link = (name: string) => screen.getByRole('link', { name });

/** The browser's «leave this page?» is asked when the event is cancelled. */
function closeTab(): boolean {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

let confirm: MockInstance<Window['confirm']>;

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/knowledge?article=one');
  confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  document.addEventListener('click', browser);
});

afterEach(() => {
  document.removeEventListener('click', browser);
  confirm.mockRestore();
});

describe('with nothing unsaved', () => {
  test('a link is followed and nothing is asked', () => {
    render(draw(false));

    fireEvent.click(link('Cleanings'));

    expect(onFollow).toHaveBeenCalledWith('/tasks');
    expect(confirm).not.toHaveBeenCalled();
  });

  test('the tab closes without a question', () => {
    render(draw(false));

    expect(closeTab()).toBe(false);
  });

  test('the screen’s own way out is free', () => {
    render(draw(false));

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(onBack).toHaveBeenCalledWith(true);
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('with unsaved changes', () => {
  test('a link in the panel asks, and stays where it is when told no', () => {
    render(draw(true));

    fireEvent.click(link('Cleanings'));

    expect(confirm).toHaveBeenCalledWith(QUESTION);
    expect(onFollow).not.toHaveBeenCalled();
  });

  test('and goes when told yes', () => {
    confirm.mockReturnValue(true);
    render(draw(true));

    fireEvent.click(link('Cleanings'));

    expect(onFollow).toHaveBeenCalledWith('/tasks');
  });

  test('a press on the text inside a link asks as well, and another address of this page counts', () => {
    render(draw(true));

    fireEvent.click(screen.getByText('The archive'));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(onFollow).not.toHaveBeenCalled();
  });

  test('a link that says it opens in this tab asks like any other', () => {
    render(draw(true));

    fireEvent.click(link('Cleanings in this tab'));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(onFollow).not.toHaveBeenCalled();
  });

  test('a link opened in another tab, or saved as a file, loses nothing and asks nothing', () => {
    render(draw(true));

    fireEvent.click(link('Cleanings in a new tab'));
    fireEvent.click(link('Cleanings'), { ctrlKey: true });
    fireEvent.click(link('Cleanings'), { metaKey: true });
    fireEvent.click(link('Cleanings'), { shiftKey: true });
    fireEvent.click(link('Cleanings'), { altKey: true });
    fireEvent.click(link('The report as a file'));

    expect(confirm).not.toHaveBeenCalled();
  });

  test('a mail link is no page of the panel and asks nothing', () => {
    render(draw(true));

    fireEvent.click(link('Write to the office'));

    expect(confirm).not.toHaveBeenCalled();
  });

  test('the panel switched to another language asks once, in its new words', () => {
    const view = render(draw(true));

    view.rerender(draw(true, 'Odejít a přijít o změny?'));
    fireEvent.click(link('Cleanings'));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith('Odejít a přijít o změny?');
  });

  test('a link to another site is left to the browser, which asks as the tab is left', () => {
    render(draw(true));

    fireEvent.click(link('Help elsewhere'));

    expect(confirm).not.toHaveBeenCalled();
  });

  test('a link down the same page asks nothing', () => {
    render(draw(true));

    fireEvent.click(link('Down the page'));

    expect(confirm).not.toHaveBeenCalled();
  });

  test('closing or reloading the tab is asked by the browser', () => {
    render(draw(true));

    expect(closeTab()).toBe(true);
  });

  test('the screen’s own way out asks the same question', () => {
    render(draw(true));

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(confirm).toHaveBeenCalledWith(QUESTION);
    expect(onBack).toHaveBeenCalledWith(false);
  });
});

describe('once the changes are saved', () => {
  test('nothing is asked any more', () => {
    const view = render(draw(true));

    view.rerender(draw(false));
    fireEvent.click(link('Cleanings'));

    expect(confirm).not.toHaveBeenCalled();
    expect(onFollow).toHaveBeenCalledWith('/tasks');
    expect(closeTab()).toBe(false);
  });

  test('nor after the screen is gone', () => {
    const view = render(draw(true));

    view.unmount();

    expect(closeTab()).toBe(false);
  });
});
