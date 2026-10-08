import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { useListPaneFocus } from '../use-list-pane-focus';

interface HarnessProps {
  open: string | null;
  /** What the open entry's heading would be told, asked by a press. */
  onClaim: (isClaimed: boolean) => void;
}

/** A list with one entry's link and a search, and the pane beside it. */
function Harness({ open, onClaim }: HarnessProps) {
  const { listRef, paneRef, noteOpening, claimHeadingFocus } = useListPaneFocus(
    open,
    'data-entry-link',
  );
  return (
    <>
      <div ref={listRef}>
        <input type="search" aria-label="Search" />
        <a href="#a" data-entry-link="a">
          Entry A
        </a>
        <button type="button" onClick={() => noteOpening('a')}>
          Open A from the list
        </button>
      </div>
      <div ref={paneRef}>
        <button type="button" onClick={() => onClaim(claimHeadingFocus())}>
          Heading appears
        </button>
      </div>
      <button type="button" onClick={() => noteOpening('a')}>
        Open A from elsewhere
      </button>
    </>
  );
}

const onClaim = vi.fn();
const draw = (open: string | null) => <Harness open={open} onClaim={onClaim} />;
const press = (name: string) => userEvent.click(screen.getByRole('button', { name }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the focus where only one of the list and the entry fits', () => {
  test('the heading of the entry opened from the list claims the focus once, however late it appears', async () => {
    const { rerender } = render(draw(null));

    await press('Open A from the list');
    rerender(draw('a'));
    // The entry's data loads: its heading appears a render later.
    rerender(draw('a'));
    await press('Heading appears');
    await press('Heading appears');

    expect(onClaim.mock.calls).toEqual([[true], [false]]);
  });

  test('a heading that never appeared does not take the focus later', async () => {
    const { rerender } = render(draw(null));

    await press('Open A from the list');
    rerender(draw('a'));
    // Not found: no heading. Closed, and another entry opened by the mouse.
    rerender(draw(null));
    rerender(draw('b'));
    await press('Heading appears');

    expect(onClaim).toHaveBeenCalledWith(false);
  });

  test('an entry opened from outside the list claims nothing', async () => {
    const { rerender } = render(draw(null));

    await press('Open A from elsewhere');
    rerender(draw('a'));
    await press('Heading appears');

    expect(onClaim).toHaveBeenCalledWith(false);
  });

  test('closing an entry from its pane gives the focus to its link in the list', async () => {
    const { rerender } = render(draw('a'));
    await press('Heading appears');

    rerender(draw(null));

    expect(screen.getByRole('link', { name: 'Entry A' })).toHaveFocus();
  });

  test('and to the search when the list does not show its link', async () => {
    const { rerender } = render(draw('zzz'));
    await press('Heading appears');

    rerender(draw(null));

    expect(screen.getByRole('searchbox')).toHaveFocus();
  });

  test('a focus outside the pane is left where it is', async () => {
    const { rerender } = render(draw('a'));
    await press('Open A from elsewhere');

    rerender(draw(null));

    expect(screen.getByRole('button', { name: 'Open A from elsewhere' })).toHaveFocus();
  });

  describe('side by side, from xl', () => {
    const matchMedia = window.matchMedia;
    beforeEach(() => {
      window.matchMedia = ((media: string) => ({
        matches: media.includes('min-width'),
        media,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      })) as unknown as typeof window.matchMedia;
    });
    afterEach(() => {
      window.matchMedia = matchMedia;
    });

    test('nothing moves the focus: both stay in view', async () => {
      const { rerender } = render(draw(null));

      await press('Open A from the list');
      rerender(draw('a'));
      await press('Heading appears');
      expect(onClaim).toHaveBeenCalledWith(false);

      rerender(draw(null));
      expect(screen.getByRole('button', { name: 'Heading appears' })).toHaveFocus();
    });
  });
});
