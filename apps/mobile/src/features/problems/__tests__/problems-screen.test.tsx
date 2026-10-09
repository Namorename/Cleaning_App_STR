import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { StyleSheet, type ViewStyle } from 'react-native';

import ProblemsScreen from '@/app/(tabs)/problems';
import { BUTTON_HEIGHT, Colors, FontSize } from '@/constants/theme';

import type { Problem } from '../schema';
import { useMyProblems } from '../use-problems';

/**
 * Her reports, wired. «Создать задание» was the first row of the list and
 * scrolled away with it (docs/design/redesign-directions.html, `pproblems`);
 * now it is one 56 dp button pinned under the list, above the tab bar.
 */

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

jest.mock('@/features/chat/use-chat', () => ({
  useUnreadSubjects: () => ({ tasks: new Set(), problems: new Set(), refetch: jest.fn() }),
}));

jest.mock('../use-problems', () => ({ useMyProblems: jest.fn() }));

/** The role in her token; a cleaner unless a test says otherwise. */
let mockRole = 'cleaner';

jest.mock('@/features/auth/session', () => ({
  useSession: () => ({
    userId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    isLoading: false,
    session: { user: { app_metadata: { role: mockRole } } },
  }),
}));

const REPORT = 'Создать задание';

function problem(overrides: Partial<Problem> = {}): Problem {
  return {
    id: 'd1e2f3a4-1111-4111-8111-d1e2f3a40001',
    property_id: 412432,
    task_id: null,
    reported_by: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    title: 'Кран течёт',
    description: null,
    priority: 'normal',
    status: 'open',
    resolved_at: null,
    cancelled_at: null,
    cancel_reason: null,
    created_at: '2026-11-10T08:00:00+00:00',
    property: { name: 'CZ - Nadrazni Apt 6', hostaway_unit_id: null, parent: null },
    ...overrides,
  } as Problem;
}

type ListAnswer = ReturnType<typeof useMyProblems>;

function answer(overrides: Partial<ListAnswer>): void {
  jest.mocked(useMyProblems).mockReturnValue({
    data: [problem()],
    isPending: false,
    error: null,
    refetch: jest.fn(),
    isRefetching: false,
    ...overrides,
  } as ListAnswer);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = 'cleaner';
  answer({});
});

// A technician has no listings to report on from here: he raises a task from
// his repair, where its listing fills itself in (docs/tech-plan.md §4). The
// head technician has none either. The list itself stays — what it holds is
// the server's to decide.
describe('the role decides the button', () => {
  test.each(['tech', 'head_tech'])('a %s gets the list without «Создать задание»', async (role) => {
    mockRole = role;

    await render(<ProblemsScreen />);

    expect(screen.getByText('Кран течёт')).toBeTruthy();
    expect(screen.queryByRole('button', { name: REPORT })).toBeNull();
  });

  test.each(['cleaner', 'manager', 'auditor'])('a %s keeps «Создать задание»', async (role) => {
    mockRole = role;

    await render(<ProblemsScreen />);

    expect(screen.getByRole('button', { name: REPORT })).toBeTruthy();
  });
});

test('«Создать задание» is a 56 dp button that starts a report', async () => {
  await render(<ProblemsScreen />);

  const button = screen.getByRole('button', { name: REPORT });
  expect((StyleSheet.flatten(button.props.style) as ViewStyle).minHeight).toBe(BUTTON_HEIGHT);
  await fireEvent.press(button);

  expect(router.push).toHaveBeenCalledWith('/problem/new');
});

test('the button is not a row of the list, so it does not scroll away', async () => {
  await render(<ProblemsScreen />);

  // The list's own scroll view, as the renderer draws it.
  const [list] = screen.container.queryAll((node) => node.type === 'RCTScrollView');
  expect(within(list).getByText('Кран течёт')).toBeTruthy();
  expect(within(list).queryByRole('button', { name: REPORT })).toBeNull();
  expect(screen.getByRole('button', { name: REPORT })).toBeTruthy();
});

test('while the list loads she can already start a report', async () => {
  answer({ data: undefined, isPending: true });

  await render(<ProblemsScreen />);

  // Said as loading: the label of the skeleton that stands in.
  expect(screen.getByRole('progressbar', { name: 'Загружаем задания…' })).toBeTruthy();
  expect(screen.getByRole('button', { name: REPORT })).toBeTruthy();
});

test('a list that cannot load keeps its retry, and the button stays under it', async () => {
  answer({ data: undefined, error: new Error('Network request failed') });

  await render(<ProblemsScreen />);

  expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();
  expect(screen.getByRole('button', { name: REPORT })).toBeTruthy();
});

test('an empty list still says so', async () => {
  answer({ data: [] });

  await render(<ProblemsScreen />);

  expect(screen.getByText('Заданий не заявлено')).toBeTruthy();
  expect(screen.getByRole('button', { name: REPORT })).toBeTruthy();
});

describe('on the «Абрикос» components', () => {
  test('while the list loads, its shape stands in for it, said as loading', async () => {
    answer({ data: undefined, isPending: true });

    await render(<ProblemsScreen />);

    const loading = screen.getByRole('progressbar', { name: 'Загружаем задания…' });
    expect(loading.props.accessibilityState).toMatchObject({ busy: true });
  });

  test('an empty list is the empty state, titled', async () => {
    answer({ data: [] });

    await render(<ProblemsScreen />);

    const empty = StyleSheet.flatten(screen.getByText('Заданий не заявлено').props.style);
    expect(empty.fontSize).toBe(FontSize.title);
  });

  test('closed reports stand under their heading, drawn as a caption', async () => {
    answer({
      data: [
        problem(),
        problem({ id: 'd1e2f3a4-1111-4111-8111-d1e2f3a40002', status: 'resolved' }),
      ],
    });

    await render(<ProblemsScreen />);

    const heading = StyleSheet.flatten(screen.getByText('Закрытые').props.style);
    expect(heading.fontSize).toBe(FontSize.caption);
    expect(heading.color).toBe(Colors.light.textSecondary);
  });
});
