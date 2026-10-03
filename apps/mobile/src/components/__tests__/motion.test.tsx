import { THEME_COLORS } from '@str-ops/shared';
import { act, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Animated, StyleSheet, type ViewStyle } from 'react-native';

import { useReducedMotion } from '@/hooks/use-reduced-motion';

import { Skeleton, SkeletonGroup } from '../skeleton';
import { TOAST_DURATION_MS, Toast } from '../toast';

/**
 * The two components that move: a loading placeholder that pulses and a
 * toast that fades in. Both say what they are to a screen reader, and both
 * hold still when the phone asks for less motion.
 */

jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: jest.fn(() => false) }));
const reduced = jest.mocked(useReducedMotion);

beforeEach(() => {
  jest.clearAllMocks();
  reduced.mockReturnValue(false);
});

describe('Skeleton', () => {
  test('is heard as one busy element saying it is loading', async () => {
    await render(
      <SkeletonGroup>
        <Skeleton height={20} />
        <Skeleton height={14} width="60%" />
      </SkeletonGroup>,
    );

    const group = screen.getByRole('progressbar', { name: 'Загрузка…' });
    expect(group.props.accessibilityState).toMatchObject({ busy: true });
  });

  test('says what is loading when the screen knows', async () => {
    await render(
      <SkeletonGroup label="Загружаем уборки…">
        <Skeleton />
      </SkeletonGroup>,
    );

    expect(screen.getByRole('progressbar', { name: 'Загружаем уборки…' })).toBeTruthy();
  });

  test('a block is a quiet shape a step off the card', async () => {
    await render(<Skeleton testID="block" height={20} />);

    const box = StyleSheet.flatten(screen.getByTestId('block').props.style) as ViewStyle;
    expect(box.backgroundColor).toBe(THEME_COLORS.light.surfaceAlt);
    expect(box.height).toBe(20);
  });

  test('pulses, unless the phone asks for less motion', async () => {
    const loop = jest.spyOn(Animated, 'loop');
    const { unmount } = await render(
      <SkeletonGroup>
        <Skeleton />
      </SkeletonGroup>,
    );
    expect(loop).toHaveBeenCalled();
    await unmount();

    loop.mockClear();
    reduced.mockReturnValue(true);
    await render(
      <SkeletonGroup>
        <Skeleton />
      </SkeletonGroup>,
    );
    expect(loop).not.toHaveBeenCalled();
  });
});

describe('Toast', () => {
  test('draws nothing without a message', async () => {
    await render(<Toast message={null} onHide={jest.fn()} />);

    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('shows its message as an alert and announces it', async () => {
    await render(<Toast message="Тема сохранена" onHide={jest.fn()} />);

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Тема сохранена')).toBeTruthy();
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('Тема сохранена');
  });

  test('goes by itself after a few seconds', async () => {
    jest.useFakeTimers();
    try {
      const onHide = jest.fn();
      await render(<Toast message="Тема сохранена" onHide={onHide} />);
      expect(onHide).not.toHaveBeenCalled();

      await act(async () => {
        await jest.advanceTimersByTimeAsync(TOAST_DURATION_MS);
      });

      expect(onHide).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  test('fades in, unless the phone asks for less motion', async () => {
    const timing = jest.spyOn(Animated, 'timing');
    const { unmount } = await render(<Toast message="Раз" onHide={jest.fn()} />);
    expect(timing).toHaveBeenCalled();
    await unmount();

    timing.mockClear();
    reduced.mockReturnValue(true);
    await render(<Toast message="Два" onHide={jest.fn()} />);
    expect(timing).not.toHaveBeenCalled();
  });
});
