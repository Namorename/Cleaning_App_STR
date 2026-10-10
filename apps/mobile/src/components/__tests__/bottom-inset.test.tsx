import { renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Platform } from 'react-native';

import { BOTTOM_INSETS, withBottomInset } from '@/testing/insets';

import { useBottomInset, useKeyboardOffset, useScreenEdgePadding } from '../bottom-inset';

/**
 * The one way a screen clears what the system draws over its bottom edge
 * (block 3, 2026-10-10): Android 15+ draws the app edge to edge, so the
 * three-button navigation bar (48 dp) or the gesture bar lies over whatever
 * sits at the bottom unless that thing rises by the inset itself.
 */

function wrapperWith(bottom: number) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return withBottomInset(bottom, children);
  };
}

const HEADER = 56;
const MARGIN = 16;

let os: { restore: () => void } | undefined;

afterEach(() => {
  os?.restore();
  os = undefined;
});

describe.each(BOTTOM_INSETS)('with a bottom inset of %i dp', (bottom) => {
  test('the inset is what the provider measured', async () => {
    const { result } = await renderHook(() => useBottomInset(), { wrapper: wrapperWith(bottom) });

    expect(result.current).toBe(bottom);
  });

  test('the edge keeps its own margin and rises by the inset', async () => {
    const { result } = await renderHook(() => useScreenEdgePadding(MARGIN), {
      wrapper: wrapperWith(bottom),
    });

    expect(result.current).toEqual({ paddingBottom: MARGIN + bottom });
  });

  test('a keyboard-avoiding view takes back what its last child rose by', async () => {
    // The view pads by all the keyboard covers, the system's bar included,
    // and its bottom bar adds the inset again: the offset subtracts it once.
    const { result } = await renderHook(() => useKeyboardOffset(HEADER), {
      wrapper: wrapperWith(bottom),
    });

    expect(result.current).toBe(HEADER - bottom);
  });

  test('on Android a scroll view the system insets on iOS still rises by the inset', async () => {
    os = jest.replaceProperty(Platform, 'OS', 'android');
    const { result } = await renderHook(
      () => useScreenEdgePadding(MARGIN, { isAdjustedOnIos: true }),
      { wrapper: wrapperWith(bottom) },
    );

    expect(result.current).toEqual({ paddingBottom: MARGIN + bottom });
  });

  test('on iOS that scroll view is not padded twice: UIKit has inset it', async () => {
    os = jest.replaceProperty(Platform, 'OS', 'ios');
    const { result } = await renderHook(
      () => useScreenEdgePadding(MARGIN, { isAdjustedOnIos: true }),
      { wrapper: wrapperWith(bottom) },
    );

    expect(result.current).toEqual({ paddingBottom: MARGIN });
  });
});

test('outside a provider — the root error screen, a bare test — there is no inset', async () => {
  const inset = await renderHook(() => useBottomInset());
  const padding = await renderHook(() => useScreenEdgePadding(MARGIN));
  const offset = await renderHook(() => useKeyboardOffset());

  expect(inset.result.current).toBe(0);
  expect(padding.result.current).toEqual({ paddingBottom: MARGIN });
  expect(offset.result.current).toBe(0);
});
