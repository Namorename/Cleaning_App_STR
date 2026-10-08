import { problemStatusTone } from '@str-ops/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

import { Colors, FontSize, Radius } from '@/constants/theme';

import { formatReportedAt } from '../format';
import { ProblemCard } from '../problem-card';
import { PROBLEM_STATUSES, type Problem } from '../schema';

/**
 * A report in her list. The whole card is one button the reader hears as
 * «title. place. status», with «Новое сообщение» when somebody wrote; the
 * status is a pill in its own tone (STATUS_TONE), not one green chip for all.
 */

const light = Colors.light;
const PROBLEM_ID = 'd1e2f3a4-1111-4111-8111-d1e2f3a40001';
const CREATED_AT = '2026-11-10T08:00:00+00:00';

function problem(overrides: Partial<Problem> = {}): Problem {
  return {
    id: PROBLEM_ID,
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

function styleOf(element: { props: { style?: unknown } }): ViewStyle & TextStyle {
  return StyleSheet.flatten(element.props.style as ViewStyle) as ViewStyle & TextStyle;
}

describe('today’s card', () => {
  test('shows the title, where and when, the status and the priority', async () => {
    await render(<ProblemCard problem={problem()} onPress={jest.fn()} />);

    expect(screen.getByText('Кран течёт')).toBeTruthy();
    expect(screen.getByText(`CZ - Nadrazni Apt 6 · ${formatReportedAt(CREATED_AT)}`)).toBeTruthy();
    expect(screen.getByText('Открыто')).toBeTruthy();
    expect(screen.getByText('Срочность: Обычная')).toBeTruthy();
  });

  test('is one button, heard as title, place and status, and opens the report', async () => {
    // Arrange
    const onPress = jest.fn();
    await render(<ProblemCard problem={problem()} onPress={onPress} />);

    // Act
    await fireEvent.press(
      screen.getByRole('button', { name: 'Кран течёт. CZ - Nadrazni Apt 6. Открыто' }),
    );

    // Assert
    expect(onPress).toHaveBeenCalledWith(PROBLEM_ID);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  test('a report somebody wrote about carries the mark, and the reader hears it', async () => {
    await render(<ProblemCard problem={problem()} onPress={jest.fn()} hasUnread />);

    expect(screen.getByText('Новое сообщение')).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Кран течёт. CZ - Nadrazni Apt 6. Открыто. Новое сообщение',
      }),
    ).toBeTruthy();
  });

  test('a report without a place says so', async () => {
    await render(<ProblemCard problem={problem({ property: null })} onPress={jest.fn()} />);

    expect(screen.getByRole('button', { name: 'Кран течёт. Без объекта. Открыто' })).toBeTruthy();
  });
});

describe('on the «Абрикос» components', () => {
  test('is a card: the surface, rounded 20', async () => {
    await render(<ProblemCard problem={problem()} onPress={jest.fn()} />);

    const card = styleOf(screen.getByRole('button'));
    expect(card.backgroundColor).toBe(light.card);
    expect(card.borderRadius).toBe(Radius.card);
  });

  test('the title is a title, where and when the secondary body', async () => {
    await render(<ProblemCard problem={problem()} onPress={jest.fn()} />);

    expect(styleOf(screen.getByText('Кран течёт')).fontSize).toBe(FontSize.title);
    const meta = styleOf(screen.getByText(`CZ - Nadrazni Apt 6 · ${formatReportedAt(CREATED_AT)}`));
    expect(meta.color).toBe(light.textSecondary);
  });

  test.each(PROBLEM_STATUSES)('the status %s is a pill in its own tone', async (status) => {
    await render(<ProblemCard problem={problem({ status })} onPress={jest.fn()} />);

    const pill = styleOf(screen.getByTestId('problem-status'));
    expect(pill.backgroundColor).toBe(light.tone[problemStatusTone(status)].bg);
    expect(pill.borderRadius).toBe(Radius.pill);
  });

  test('a high priority is the «Срочно» pill in the urgent tone, and the reader hears it', async () => {
    await render(<ProblemCard problem={problem({ priority: 'high' })} onPress={jest.fn()} />);

    const urgent = screen.getByTestId('problem-urgent');
    expect(styleOf(urgent).backgroundColor).toBe(light.tone.urgent.bg);
    expect(screen.getByText('Срочно')).toBeTruthy();
    expect(screen.queryByText('Срочность: Высокая')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Кран течёт. CZ - Nadrazni Apt 6. Открыто. Срочно' }),
    ).toBeTruthy();
  });

  test('a normal priority has no pill, only its line', async () => {
    await render(<ProblemCard problem={problem()} onPress={jest.fn()} />);

    expect(screen.queryByTestId('problem-urgent')).toBeNull();
    expect(styleOf(screen.getByText('Срочность: Обычная')).fontSize).toBe(FontSize.caption);
  });
});
