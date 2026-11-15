import { fireEvent, render, screen } from '@testing-library/react-native';

import NewProblemRoute from '@/app/problem/new';
import type { ReportProperty } from '@/features/properties/schema';
import { useReportProperties } from '@/features/properties/use-properties';

import type { ProblemCategory } from '../categories';
import { useReportCatalog } from '../use-problem-categories';
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
// The typed title unless a test hands the cleaner a catalogue.
jest.mock('../use-problem-categories', () => ({ useReportCatalog: jest.fn(() => null) }));

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

describe('a company that reports by catalogue (CLIENT:Wagnerstays)', () => {
  const wifi: ProblemCategory = {
    id: '2ca940fd-288f-43f5-a6df-93145e10cd67',
    name: 'Wi-Fi',
    name_i18n: { en: 'Wi-Fi', cs: 'Wi-Fi' },
    synonyms: ['wifi', 'вайфай', 'интернет'],
    priority: 'high',
  };

  test('the report carries the category she picked, its name and its urgency', async () => {
    jest.mocked(useReportCatalog).mockReturnValue([wifi]);
    placesAre([house]);

    await render(<NewProblemRoute />);
    await fireEvent.press(screen.getByRole('button', { name: 'Категория' }));
    await fireEvent.changeText(screen.getByLabelText('Начните вводить название категории'), 'вайф');
    await fireEvent.press(screen.getByRole('button', { name: 'Wi-Fi, срочность: Высокая' }));
    await fireEvent.changeText(screen.getByLabelText('Подробности'), 'Роутер мигает');
    await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        problemId: PROBLEM_ID,
        categoryId: wifi.id,
        title: 'Wi-Fi',
        priority: 'high',
        description: 'Роутер мигает',
        propertyId: 1,
      }),
    );
  });

  test('without the catalogue on the phone she types the title, and no category goes', async () => {
    jest.mocked(useReportCatalog).mockReturnValue(null);
    placesAre([house]);

    await render(<NewProblemRoute />);
    expect(screen.queryByRole('button', { name: 'Категория' })).toBeNull();
    await sendWithTitle('Нет интернета');

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Нет интернета', priority: 'normal', categoryId: null }),
    );
  });
});

describe('the level above high, «Критическая» (20261115090000)', () => {
  test('she picks «Критическая»: the report goes as high with the flag', async () => {
    placesAre([house]);

    await render(<NewProblemRoute />);
    await fireEvent.press(screen.getByRole('radio', { name: 'Критическая' }));
    await sendWithTitle('Прорвало трубу');

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Прорвало трубу', priority: 'high', critical: true }),
    );
  });

  test('below it the report carries no flag at all, as a build before the level sent it', async () => {
    placesAre([house]);

    await render(<NewProblemRoute />);
    await fireEvent.press(screen.getByRole('radio', { name: 'Высокая' }));
    await sendWithTitle('Нет Wi-Fi');

    expect(mutate.mock.calls[0][0]).toMatchObject({ priority: 'high' });
    expect(mutate.mock.calls[0][0]).not.toHaveProperty('critical');
  });
});
