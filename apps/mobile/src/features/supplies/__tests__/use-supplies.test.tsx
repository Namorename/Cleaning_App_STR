import { renderHook } from '@testing-library/react-native';

import { restoredFromDisk, withClient } from '@/testing/restored-cache';

import { fetchMySupplyRequests, fetchSupplyRequest } from '../api';
import { supplyKeys } from '../keys';
import { useMySupplyRequests, useSupplyRequest } from '../use-supplies';

jest.mock('../api', () => ({
  fetchSupplyCatalog: jest.fn(),
  fetchMySupplyRequests: jest.fn(),
  fetchSupplyRequest: jest.fn(),
  saveSupplyRequest: jest.fn(),
  deleteSupplyRequest: jest.fn(),
}));

jest.mock('@/features/auth/session', () => ({
  useSession: () => ({ userId: '7c9e6679-7425-40de-944b-e07fc1f90ae7' }),
}));

/** A request as the build before 6f29db2 read it: the listing's name and nothing else. */
const REQUEST_BEFORE_THE_HOUSE = {
  id: 'c9ff0001-0000-4000-8000-000000000001',
  requested_by: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  property_id: 412432,
  task_id: null,
  status: 'new',
  priority: 'normal',
  note: null,
  needed_by: null,
  reviewed_at: null,
  fulfilled_at: null,
  reject_reason: null,
  created_at: '2026-09-16T10:00:00+00:00',
  property: { name: '1 - 2109' },
  items: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  // The refresh never answers, so the screen draws what the disk gave.
  (fetchMySupplyRequests as jest.Mock).mockReturnValue(new Promise(() => {}));
  (fetchSupplyRequest as jest.Mock).mockReturnValue(new Promise(() => {}));
});

test('her requests saved before the house was asked for read with none, not undefined', async () => {
  // Arrange
  const client = restoredFromDisk(supplyKeys.mine(), [REQUEST_BEFORE_THE_HOUSE]);

  // Act
  const { result } = await renderHook(() => useMySupplyRequests(), {
    wrapper: withClient(client),
  });

  // Assert
  expect(result.current.data?.[0].property).toEqual({
    name: '1 - 2109',
    hostaway_unit_id: null,
    parent: null,
  });
});

test('a request opened from that list is read the same way', async () => {
  // Arrange: the request screen starts from the list's copy of the row.
  const client = restoredFromDisk(supplyKeys.mine(), [REQUEST_BEFORE_THE_HOUSE]);

  // Act
  const { result } = await renderHook(() => useSupplyRequest(REQUEST_BEFORE_THE_HOUSE.id), {
    wrapper: withClient(client),
  });

  // Assert
  expect(result.current.data?.property?.parent).toBeNull();
});
