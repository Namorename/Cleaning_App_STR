import { problemStatusTone } from '@str-ops/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

import { BUTTON_HEIGHT, Colors, FontSize, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { BOTTOM_INSETS, scrollEndPadding, withBottomInset } from '@/testing/insets';

import { formatReportedAt } from '../format';
import { ProblemDetail } from '../problem-detail';
import type { Problem } from '../schema';

/**
 * One report, as it stands. What she may still do with it is the route's to
 * decide (canEdit, fixTaskId, onPickFromGallery); this screen shows exactly
 * those moves and the facts of the report.
 */

jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: jest.fn(() => 'light') }));
const scheme = jest.mocked(useColorScheme);

beforeEach(() => {
  scheme.mockReturnValue('light');
});

const light = Colors.light;
const CREATED_AT = '2026-11-10T08:00:00+00:00';
const FIX_TASK = 'b1c2d3e4-2222-4222-8222-b1c2d3e40001';

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
    created_at: CREATED_AT,
    property: { name: 'CZ - Nadrazni Apt 6', hostaway_unit_id: null, parent: null },
    fix_tasks: [],
    ...overrides,
  };
}

type Props = ComponentProps<typeof ProblemDetail>;

function props(overrides: Partial<Props> = {}): Props {
  return {
    problem: problem(),
    photos: [],
    canEdit: false,
    onEdit: jest.fn(),
    onCapture: jest.fn(),
    onRemovePhoto: jest.fn(),
    onRetryPhoto: jest.fn(),
    isCapturing: false,
    fixTaskId: null,
    onOpenFixTask: jest.fn(),
    error: null,
    notice: null,
    ...overrides,
  };
}

function styleOf(element: { props: { style?: unknown } }): ViewStyle & TextStyle {
  return StyleSheet.flatten(element.props.style as ViewStyle) as ViewStyle & TextStyle;
}

describe('today’s screen', () => {
  test('shows the report: title, where and when, status, priority and the details', async () => {
    await render(
      <ProblemDetail {...props({ problem: problem({ description: 'Под раковиной' }) })} />,
    );

    expect(screen.getByText('Кран течёт')).toBeTruthy();
    expect(screen.getByText(`CZ - Nadrazni Apt 6 · ${formatReportedAt(CREATED_AT)}`)).toBeTruthy();
    expect(screen.getByText('Статус')).toBeTruthy();
    expect(screen.getByText('Открыто')).toBeTruthy();
    expect(screen.getByText('Срочность')).toBeTruthy();
    expect(screen.getByText('Обычная')).toBeTruthy();
    expect(screen.getByText('Подробности')).toBeTruthy();
    expect(screen.getByText('Под раковиной')).toBeTruthy();
  });

  test('a cancelled report says why', async () => {
    await render(
      <ProblemDetail
        {...props({ problem: problem({ status: 'cancelled', cancel_reason: 'Дубль' }) })}
      />,
    );

    expect(screen.getByText('Отменено')).toBeTruthy();
    expect(screen.getByText('Причина отмены')).toBeTruthy();
    expect(screen.getByText('Дубль')).toBeTruthy();
  });

  test('the reporter of an open report may change it and add photos', async () => {
    // Arrange
    const onEdit = jest.fn();
    const onCapture = jest.fn();
    await render(<ProblemDetail {...props({ canEdit: true, onEdit, onCapture })} />);

    // Act
    await fireEvent.press(screen.getByRole('button', { name: 'Изменить' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Снять фото' }));

    // Assert
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onCapture).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Фото нет')).toBeNull();
  });

  test('anyone else reads it: no change, no camera, and «Фото нет» without photos', async () => {
    await render(<ProblemDetail {...props({ canEdit: false })} />);

    expect(screen.queryByRole('button', { name: 'Изменить' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Снять фото' })).toBeNull();
    expect(screen.getByText('Фото нет')).toBeTruthy();
  });

  test('the gallery is offered only when the route hands it over', async () => {
    const onPickFromGallery = jest.fn();
    await render(<ProblemDetail {...props({ canEdit: true, onPickFromGallery })} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Выбрать фото из галереи' }));

    expect(onPickFromGallery).toHaveBeenCalledTimes(1);
  });

  test('photos are shown, each named by its place and state', async () => {
    await render(
      <ProblemDetail
        {...props({
          photos: [{ id: 'm1', uri: 'file:///m1.jpg', status: 'uploaded' }],
        })}
      />,
    );

    expect(screen.queryByText('Фото нет')).toBeNull();
    expect(screen.getByLabelText('Фото 1. Загружено')).toBeTruthy();
  });

  test('the chat is offered when the route hands it over, and opens', async () => {
    const onOpenChat = jest.fn();
    await render(<ProblemDetail {...props({ onOpenChat })} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Чат' }));

    expect(onOpenChat).toHaveBeenCalledTimes(1);
  });

  test('without a chat handler there is no chat button', async () => {
    await render(<ProblemDetail {...props()} />);

    expect(screen.queryByRole('button', { name: 'Чат' })).toBeNull();
  });

  test('the fix task she works on is one press away', async () => {
    const onOpenFixTask = jest.fn();
    await render(<ProblemDetail {...props({ fixTaskId: FIX_TASK, onOpenFixTask })} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Открыть работу техника' }));

    expect(onOpenFixTask).toHaveBeenCalledWith(FIX_TASK);
  });

  test('without a fix task of hers there is no such button', async () => {
    await render(<ProblemDetail {...props()} />);

    expect(screen.queryByRole('button', { name: 'Открыть работу техника' })).toBeNull();
  });

  test('a failed move is said in her words, and a capture that did not happen too', async () => {
    await render(
      <ProblemDetail
        {...props({
          error: {
            message: 'The message is too long',
            hint: 'serverErrors.messageTooLong',
            details: '{"limit":4000}',
          } as unknown as Error,
          notice: 'Нет доступа к камере',
        })}
      />,
    );

    expect(screen.getByText('В сообщении не больше 4000 символов')).toBeTruthy();
    expect(screen.getByText('Нет доступа к камере')).toBeTruthy();
  });
});

describe('on the «Абрикос» components', () => {
  test('the title is a heading', async () => {
    await render(<ProblemDetail {...props()} />);

    expect(styleOf(screen.getByText('Кран течёт')).fontSize).toBe(FontSize.heading);
  });

  test('the status is a pill in its own tone', async () => {
    await render(<ProblemDetail {...props({ problem: problem({ status: 'in_progress' }) })} />);

    expect(styleOf(screen.getByTestId('problem-status')).backgroundColor).toBe(
      light.tone[problemStatusTone('in_progress')].bg,
    );
    expect(screen.getByText('В работе')).toBeTruthy();
  });

  test('a high priority carries the «Срочно» pill in the urgent tone', async () => {
    await render(<ProblemDetail {...props({ problem: problem({ priority: 'high' }) })} />);

    expect(styleOf(screen.getByTestId('problem-urgent')).backgroundColor).toBe(
      light.tone.urgent.bg,
    );
    expect(screen.getByText('Срочно')).toBeTruthy();
    expect(screen.getByText('Высокая')).toBeTruthy();
  });

  test('a normal priority carries no pill', async () => {
    await render(<ProblemDetail {...props()} />);

    expect(screen.queryByTestId('problem-urgent')).toBeNull();
  });

  test('the fix task is the 56 dp main button; chat and change are outlined', async () => {
    await render(
      <ProblemDetail {...props({ canEdit: true, fixTaskId: FIX_TASK, onOpenChat: jest.fn() })} />,
    );

    const main = styleOf(screen.getByRole('button', { name: 'Открыть работу техника' }));
    expect(main.minHeight).toBe(BUTTON_HEIGHT);
    expect(main.backgroundColor).toBe(light.cta);
    for (const name of ['Чат', 'Изменить']) {
      const quiet = styleOf(screen.getByRole('button', { name }));
      expect(quiet.minHeight).toBe(BUTTON_HEIGHT);
      expect(quiet.borderColor).toBe(light.primary);
      expect(quiet.backgroundColor).toBe('transparent');
    }
  });

  test('dark theme: the status pill and «Срочно» are the dark tones', async () => {
    scheme.mockReturnValue('dark');

    await render(<ProblemDetail {...props({ problem: problem({ priority: 'high' }) })} />);

    expect(styleOf(screen.getByTestId('problem-status')).backgroundColor).toBe(
      Colors.dark.tone[problemStatusTone('open')].bg,
    );
    expect(styleOf(screen.getByTestId('problem-urgent')).backgroundColor).toBe(
      Colors.dark.tone.urgent.bg,
    );
  });
});

// Block 3 (2026-10-10): Android's three-button navigation bar lay over the
// bottom of the report. «Изменить» is the last thing on the screen; scrolled
// to the end, it stops clear of the system's bar.
test.each(BOTTOM_INSETS)(
  'with a bottom inset of %i dp «Изменить» scrolls clear of the system’s bar',
  async (bottom) => {
    await render(withBottomInset(bottom, <ProblemDetail {...props({ canEdit: true })} />));

    expect(screen.getByRole('button', { name: 'Изменить' })).toBeTruthy();
    expect(scrollEndPadding()).toBe(Spacing.lg + bottom);
  },
);
