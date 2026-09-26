import { renderHook } from '@testing-library/react-native';

import { restoredFromDisk, withClient } from '@/testing/restored-cache';

import { fetchReportProperties } from '../api';
import { propertyKeys } from '../keys';
import { useReportProperties } from '../use-properties';

jest.mock('../api', () => ({ fetchReportProperties: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  // The refresh never answers, so the picker draws what the disk gave.
  (fetchReportProperties as jest.Mock).mockReturnValue(new Promise(() => {}));
});

test('a place list the phone cannot read is a short error, not a broken picker', async () => {
  // Arrange: the unit id as the first build of the picker declared it — a string.
  const client = restoredFromDisk(propertyKeys.reportable(), [
    {
      id: 1,
      name: '1 - 2109',
      parent_id: 7,
      hostaway_unit_id: '18007',
      parent_name: 'CZ - Vinohradska',
    },
  ]);

  // Act
  const { result } = await renderHook(() => useReportProperties(), {
    wrapper: withClient(client),
  });

  // Assert
  expect(result.current.isError).toBe(true);
  expect(result.current.error?.message).toMatch(
    /^Cached report places unreadable at 0\.hostaway_unit_id/,
  );
});

test('a list it can read reaches the picker as it was', async () => {
  // Arrange
  const row = {
    id: 1,
    name: 'CZ - Nadrazni Apt 6',
    parent_id: null,
    hostaway_unit_id: null,
    parent_name: null,
  };
  const client = restoredFromDisk(propertyKeys.reportable(), [row]);

  // Act
  const { result } = await renderHook(() => useReportProperties(), {
    wrapper: withClient(client),
  });

  // Assert
  expect(result.current.data).toEqual([row]);
});
