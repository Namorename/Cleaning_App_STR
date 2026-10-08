import { fireEvent, render, screen } from '@testing-library/react-native';

import NewProblemRoute from '@/app/problem/new';
import type { ReportProperty } from '@/features/properties/schema';
import { useReportProperties } from '@/features/properties/use-properties';

import { useReportProblem } from '../use-problems';

/**
 * Reporting from the list of reports, wired: where it happened is hers to
 * choose, from her own places, unless there is only one to choose from. What
 * the report sends is the route's contract with the queue, so it is read here
 * off the mutation rather than assumed.
 */

const PROBLEM_ID = 'f1a2b3c4-1111-4111-8111-f1a2b3c40001';

let mockParams: Record<string, string | undefined> = {};

jest.mock('expo-crypto', () => ({ randomUUID: () => 'f1a2b3c4-1111-4111-8111-f1a2b3c40001' }));

jest.mock('expo-router', () => ({
  router: { replace: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));

jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => false }));

jest.mock('@/features/media/capture', () => ({
  capturePhoto: jest.fn(),
  pickPhotoFromGallery: jest.fn(),
}));
jest.mock('@/features/media/file', () => ({ discardFile: jest.fn() }));
jest.mock('@/features/media/use-media', () => ({ useRememberLocalMedia: () => jest.fn() }));
jest.mock('@/features/host/use-host', () => ({ useGalleryAllowed: () => false }));
jest.mock('@/features/tasks/use-tasks', () => ({ useTask: () => ({ data: undefined }) }));
jest.mock('@/features/properties/use-properties', () => ({ useReportProperties: jest.fn() }));
jest.mock('../use-problems', () => ({ useReportProblem: jest.fn() }));

const house: ReportProperty = {
  id: 1,
  name: 'Nadrazni 6',
  parent_id: null,
  hostaway_unit_id: null,
  parent_name: null,
};
const room: ReportProperty = {
  id: 2,
  name: '1 - 2109',
  parent_id: 7,
  hostaway_unit_id: 2,
  parent_name: 'Vinohradska Royal',
};

const mutate = jest.fn();

function placesAre(data: ReportProperty[] | undefined, isPending = false): void {
  jest
    .mocked(useReportProperties)
    .mockReturnValue({ data, isPending } as ReturnType<typeof useReportProperties>);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  jest.mocked(useReportProblem).mockReturnValue({
    mutate,
    isPending: false,
    isPaused: false,
    isSuccess: false,
    error: null,
  } as unknown as ReturnType<typeof useReportProblem>);
});

async function sendWithTitle(title: string): Promise<void> {
  await fireEvent.changeText(screen.getByLabelText('Что случилось'), title);
  await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));
}

test('a cleaner with one place finds it chosen, and the report carries it', async () => {
  placesAre([house]);

  await render(<NewProblemRoute />);
  expect(screen.getByText('Nadrazni 6')).toBeTruthy();
  await sendWithTitle('Кран течёт');

  expect(mutate).toHaveBeenCalledWith(
    expect.objectContaining({ problemId: PROBLEM_ID, title: 'Кран течёт', propertyId: 1 }),
  );
});

test('with more than one place nothing is chosen for her', async () => {
  placesAre([house, room]);

  await render(<NewProblemRoute />);
  expect(screen.getByText('Выберите объект')).toBeTruthy();
  await sendWithTitle('Кран течёт');

  expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ propertyId: null }));
});

test('the place she picks in the sheet is the one the report carries', async () => {
  placesAre([house, room]);

  await render(<NewProblemRoute />);
  await fireEvent.press(screen.getByRole('button', { name: 'Где' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Vinohradska Royal — 1 - 2109' }));
  await sendWithTitle('Кран течёт');

  expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ propertyId: 2 }));
});

test('a place in the link comes chosen', async () => {
  mockParams = { propertyId: '2' };
  placesAre([house, room]);

  await render(<NewProblemRoute />);

  expect(screen.getByText('Vinohradska Royal — 1 - 2109')).toBeTruthy();
});

test('a report filed on a task sends the task, not a place', async () => {
  mockParams = { taskId: '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b' };
  placesAre([house]);

  await render(<NewProblemRoute />);
  await sendWithTitle('Кран течёт');

  expect(screen.queryByRole('button', { name: 'Где' })).toBeNull();
  expect(mutate).toHaveBeenCalledWith(
    expect.objectContaining({ taskId: '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b', propertyId: null }),
  );
});
