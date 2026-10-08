import { supplyStatusTone } from '@str-ops/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

import { Colors, FontSize, Radius } from '@/constants/theme';
import { formatReportedAt } from '@/features/problems/format';

import { SupplyCard } from '../supply-card';
import { SUPPLY_STATUSES, type SupplyRequest } from '../schema';

/**
 * A request in her list. The whole card is one button the reader hears as
 * «place. lines. status»; the status is a pill in its own tone (STATUS_TONE),
 * and an urgent request carries «Срочно» in the urgent tone.
 */

const light = Colors.light;
const REQUEST_ID = 'b7c8d9e0-3333-4333-8333-b7c8d9e00001';
const CREATED_AT = '2026-11-10T08:00:00+00:00';
const SUMMARY = 'Мешки для мусора × 2 упак';

function request(overrides: Partial<SupplyRequest> = {}): SupplyRequest {
  return {
    id: REQUEST_ID,
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

function styleOf(element: { props: { style?: unknown } }): ViewStyle & TextStyle {
  return StyleSheet.flatten(element.props.style as ViewStyle) as ViewStyle & TextStyle;
}

describe('today’s card', () => {
  test('shows the place, the lines, the status and when', async () => {
    await render(<SupplyCard request={request()} onPress={jest.fn()} />);

    expect(screen.getByText('CZ - Nadrazni Apt 6')).toBeTruthy();
    expect(screen.getByText(SUMMARY)).toBeTruthy();
    expect(screen.getByText('Новая')).toBeTruthy();
    expect(screen.getByText(formatReportedAt(CREATED_AT))).toBeTruthy();
    expect(screen.queryByText(/Срочно/)).toBeNull();
  });

  test('is one button, heard as place, lines and status, and opens the request', async () => {
    // Arrange
    const onPress = jest.fn();
    await render(<SupplyCard request={request()} onPress={onPress} />);

    // Act
    await fireEvent.press(
      screen.getByRole('button', { name: `CZ - Nadrazni Apt 6. ${SUMMARY}. Новая` }),
    );

    // Assert
    expect(onPress).toHaveBeenCalledWith(REQUEST_ID);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  test('an urgent request says so', async () => {
    await render(<SupplyCard request={request({ priority: 'urgent' })} onPress={jest.fn()} />);

    expect(screen.getByText(/Срочно/)).toBeTruthy();
  });

  test('a request without a place is the general one', async () => {
    await render(<SupplyCard request={request({ property: null })} onPress={jest.fn()} />);

    expect(screen.getByRole('button', { name: `Общая заявка. ${SUMMARY}. Новая` })).toBeTruthy();
  });
});

describe('on the «Абрикос» components', () => {
  test('is a card: the surface, rounded 20', async () => {
    await render(<SupplyCard request={request()} onPress={jest.fn()} />);

    const card = styleOf(screen.getByRole('button'));
    expect(card.backgroundColor).toBe(light.card);
    expect(card.borderRadius).toBe(Radius.card);
  });

  test('the place is a title, the lines body, when a secondary caption', async () => {
    await render(<SupplyCard request={request()} onPress={jest.fn()} />);

    expect(styleOf(screen.getByText('CZ - Nadrazni Apt 6')).fontSize).toBe(FontSize.title);
    expect(styleOf(screen.getByText(SUMMARY)).fontSize).toBe(FontSize.body);
    const when = styleOf(screen.getByText(formatReportedAt(CREATED_AT)));
    expect(when.fontSize).toBe(FontSize.caption);
    expect(when.color).toBe(light.textSecondary);
  });

  test.each(SUPPLY_STATUSES)('the status %s is a pill in its own tone', async (status) => {
    await render(<SupplyCard request={request({ status })} onPress={jest.fn()} />);

    const pill = styleOf(screen.getByTestId('supply-status'));
    expect(pill.backgroundColor).toBe(light.tone[supplyStatusTone(status)].bg);
    expect(pill.borderRadius).toBe(Radius.pill);
  });

  test('urgent is the «Срочно» pill in the urgent tone, and the reader hears it', async () => {
    await render(<SupplyCard request={request({ priority: 'urgent' })} onPress={jest.fn()} />);

    const urgent = screen.getByTestId('supply-urgent');
    expect(styleOf(urgent).backgroundColor).toBe(light.tone.urgent.bg);
    expect(screen.getByText('Срочно')).toBeTruthy();
    // The date stands alone now: «Срочно» is the pill, not a tail of the line.
    expect(screen.getByText(formatReportedAt(CREATED_AT))).toBeTruthy();
    expect(
      screen.getByRole('button', { name: `CZ - Nadrazni Apt 6. ${SUMMARY}. Новая. Срочно` }),
    ).toBeTruthy();
  });

  test('a normal request has no urgency pill', async () => {
    await render(<SupplyCard request={request()} onPress={jest.fn()} />);

    expect(screen.queryByTestId('supply-urgent')).toBeNull();
  });
});
