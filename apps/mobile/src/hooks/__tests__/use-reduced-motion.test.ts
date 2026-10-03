import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { useReducedMotion } from '../use-reduced-motion';

/** What the phone says about motion, read at once and followed as it changes. */

type MotionListener = (isReduced: boolean) => void;

test('reads the setting, and follows it when it changes', async () => {
  jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockResolvedValueOnce(true);
  let listener: MotionListener = () => undefined;
  const remove = jest.fn();
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementationOnce((_event, handler) => {
    listener = handler as unknown as MotionListener;
    return { remove } as unknown as ReturnType<typeof AccessibilityInfo.addEventListener>;
  });

  const { result, unmount } = await renderHook(() => useReducedMotion());
  await waitFor(() => expect(result.current).toBe(true));

  await act(async () => listener(false));
  expect(result.current).toBe(false);

  await unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});
