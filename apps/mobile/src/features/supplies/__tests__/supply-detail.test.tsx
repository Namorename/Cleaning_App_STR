import { fireEvent, render, screen, within } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

import { BUTTON_HEIGHT, Colors, FontSize, Radius } from '@/constants/theme';
import { formatReportedAt } from '@/features/problems/format';

import { SUPPLY_STATUSES, type SupplyRequest } from '../schema';
import { SupplyDetail } from '../supply-detail';

/**
 * One request, as it stands. Whether she may still change or withdraw it is
 * the route's to decide (`canEdit`); this screen shows exactly those moves and
 * the facts: the status, the urgency, the lines, the note, a refusal's reason.
 */

const light = Colors.light;
const CREATED_AT = '2026-11-10T08:00:00+00:00';
const GENERAL = 'Не удалось выполнить действие. Попробуйте ещё раз.';

function request(overrides: Partial<SupplyRequest> = {}): SupplyRequest {
  return {
    id: 'b7c8d9e0-3333-4333-8333-b7c8d9e00001',
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
    created_at: CREATED_AT,
    property: { name: 'CZ - Nadrazni Apt 6', hostaway_unit_id: null, parent: null },
    items: [
      {
        id: 'e1f2a3b4-2222-4222-8222-e1f2a3b40002',
        name: 'Средство для стёкол',
        quantity: 1.5,
        unit: 'l',
        comment: 'Без запаха',
        catalog_item_id: null,
        sort_order: 2,
      },
      {
        id: 'e1f2a3b4-2222-4222-8222-e1f2a3b40001',
        name: 'Мешки для мусора',
        quantity: 2,
        unit: 'pack',
        comment: null,
        catalog_item_id: null,
        sort_order: 1,
      },
    ],
    ...overrides,
  };
}

type Props = ComponentProps<typeof SupplyDetail>;

function props(overrides: Partial<Props> = {}): Props {
  return {
    request: request(),
    canEdit: false,
    onEdit: jest.fn(),
    onDelete: jest.fn(),
    isDeleting: false,
    error: null,
    ...overrides,
  };
}

function styleOf(element: { props: { style?: unknown } }): ViewStyle & TextStyle {
  return StyleSheet.flatten(element.props.style as ViewStyle) as ViewStyle & TextStyle;
}

describe('today’s screen', () => {
  test('shows where, when, the status and the urgency', async () => {
    await render(<SupplyDetail {...props()} />);

    expect(screen.getByText('CZ - Nadrazni Apt 6')).toBeTruthy();
    expect(screen.getByText(formatReportedAt(CREATED_AT))).toBeTruthy();
    expect(screen.getByText('Статус')).toBeTruthy();
    expect(screen.getByText('Новая')).toBeTruthy();
    expect(screen.getByText('Срочность')).toBeTruthy();
    expect(screen.getByText('Обычная')).toBeTruthy();
  });

  test('lists the lines in her order, each with its quantity and comment', async () => {
    await render(<SupplyDetail {...props()} />);

    expect(screen.getByText('Позиции')).toBeTruthy();
    const names = screen.getAllByText(/^(Мешки для мусора|Средство для стёкол)$/);
    expect(names.map((name) => name.props.children)).toEqual([
      'Мешки для мусора',
      'Средство для стёкол',
    ]);
    expect(screen.getByText('2 упак')).toBeTruthy();
    expect(screen.getByText('1.50 л')).toBeTruthy();
    expect(screen.getByText('Без запаха')).toBeTruthy();
  });

  test('the note and a refusal’s reason are shown when there are some', async () => {
    await render(
      <SupplyDetail
        {...props({
          request: request({
            status: 'rejected',
            note: 'До пятницы',
            reject_reason: 'Есть на складе',
          }),
        })}
      />,
    );

    expect(screen.getByText('Комментарий')).toBeTruthy();
    expect(screen.getByText('До пятницы')).toBeTruthy();
    expect(screen.getByText('Причина отказа')).toBeTruthy();
    expect(screen.getByText('Есть на складе')).toBeTruthy();
  });

  test('without a note or a refusal neither heading is drawn', async () => {
    await render(<SupplyDetail {...props()} />);

    expect(screen.queryByText('Комментарий')).toBeNull();
    expect(screen.queryByText('Причина отказа')).toBeNull();
  });

  test('a request she may not change has no moves', async () => {
    await render(<SupplyDetail {...props()} />);

    expect(screen.queryByRole('button')).toBeNull();
  });

  test('her new request: «Изменить» and «Удалить заявку» each do their move', async () => {
    // Arrange
    const onEdit = jest.fn();
    const onDelete = jest.fn();
    await render(<SupplyDetail {...props({ canEdit: true, onEdit, onDelete })} />);

    // Act
    await fireEvent.press(screen.getByRole('button', { name: 'Изменить' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Удалить заявку' }));

    // Assert
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  test('while it is being withdrawn, neither move answers a second tap', async () => {
    // Arrange
    const onEdit = jest.fn();
    const onDelete = jest.fn();
    await render(
      <SupplyDetail {...props({ canEdit: true, onEdit, onDelete, isDeleting: true })} />,
    );

    // Act
    await fireEvent.press(screen.getByRole('button', { name: 'Изменить' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Удалить заявку' }));

    // Assert
    expect(onEdit).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Удалить заявку' }).props.accessibilityState,
    ).toMatchObject({ disabled: true, busy: true });
  });

  test('a failed withdrawal is said in her language, the raw words under it', async () => {
    await render(
      <SupplyDetail {...props({ canEdit: true, error: new Error('Network request failed') })} />,
    );

    expect(screen.getByText(GENERAL)).toBeTruthy();
    expect(screen.getByText('Network request failed')).toBeTruthy();
  });
});

describe('on the «Абрикос» components', () => {
  test('the place is a heading, when the secondary body', async () => {
    await render(<SupplyDetail {...props()} />);

    expect(styleOf(screen.getByText('CZ - Nadrazni Apt 6')).fontSize).toBe(FontSize.heading);
    expect(styleOf(screen.getByText(formatReportedAt(CREATED_AT))).color).toBe(light.textSecondary);
  });

  test.each(SUPPLY_STATUSES)('the status %s is a pill', async (status) => {
    await render(<SupplyDetail {...props({ request: request({ status }) })} />);

    expect(styleOf(screen.getByTestId('supply-status')).borderRadius).toBe(Radius.pill);
  });

  // Pinned by name, not recomputed with the function under test: a change of
  // the contract has to change these lines too.
  test.each([
    ['new', 'unassigned'],
    ['rejected', 'cancelled'],
  ] as const)('the status %s is drawn in the %s tone', async (status, tone) => {
    await render(<SupplyDetail {...props({ request: request({ status }) })} />);

    expect(styleOf(screen.getByTestId('supply-status')).backgroundColor).toBe(light.tone[tone].bg);
  });

  test('urgent is the «Срочно» pill in the urgent tone; normal stays a word', async () => {
    const view = await render(
      <SupplyDetail {...props({ request: request({ priority: 'urgent' }) })} />,
    );

    expect(styleOf(screen.getByTestId('supply-urgent')).backgroundColor).toBe(light.tone.urgent.bg);
    expect(screen.getByText('Срочно')).toBeTruthy();

    await view.rerender(<SupplyDetail {...props()} />);

    expect(screen.queryByTestId('supply-urgent')).toBeNull();
    expect(screen.getByText('Обычная')).toBeTruthy();
  });

  test('each line is a card', async () => {
    await render(<SupplyDetail {...props()} />);

    const line = styleOf(screen.getByTestId('supply-line-e1f2a3b4-2222-4222-8222-e1f2a3b40001'));
    expect(line.backgroundColor).toBe(light.card);
    expect(line.borderRadius).toBe(Radius.card);
  });

  test('«Изменить» is the 56 dp main button, «Удалить заявку» the destructive one', async () => {
    await render(<SupplyDetail {...props({ canEdit: true })} />);

    const edit = styleOf(screen.getByRole('button', { name: 'Изменить' }));
    expect(edit.minHeight).toBe(BUTTON_HEIGHT);
    expect(edit.backgroundColor).toBe(light.cta);
    const remove = styleOf(screen.getByRole('button', { name: 'Удалить заявку' }));
    expect(remove.minHeight).toBe(BUTTON_HEIGHT);
    expect(remove.backgroundColor).toBe(light.tone.urgent.bg);
    expect(styleOf(screen.getByText('Удалить заявку')).color).toBe(light.danger);
  });

  test('while it is being withdrawn the delete button keeps its words beside the spinner', async () => {
    await render(<SupplyDetail {...props({ canEdit: true, isDeleting: true })} />);

    const remove = screen.getByRole('button', { name: 'Удалить заявку' });
    expect(within(remove).getByText('Удалить заявку')).toBeTruthy();
    const spinners = remove.children.filter(
      (child) => typeof child !== 'string' && child.type === 'ActivityIndicator',
    );
    expect(spinners).toHaveLength(1);
  });
});
