import { render, screen } from '@testing-library/react-native';
import { StyleSheet, type TextStyle } from 'react-native';

import { FontSize } from '@/constants/theme';
import { ProblemList } from '@/features/problems/problem-list';
import type { Problem } from '@/features/problems/schema';
import type { SupplyRequest } from '@/features/supplies/schema';
import { SupplyList } from '@/features/supplies/supply-list';

/**
 * Error over cache (docs/redesign-plan.md §2.2): every list is kept on the
 * phone, so a refresh that fails still has yesterday's list to show. The
 * list stays and a line above it says what happened; the error screen is for
 * a list that never loaded at all.
 */

const ME = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const STALE = 'Не удалось обновить, показано сохранённое. Потяните вниз, чтобы повторить.';
const GENERAL = 'Не удалось выполнить действие. Попробуйте ещё раз.';

const noop = () => {};
const listProps = { isLoading: false, onRefresh: noop, isRefreshing: false, onPress: noop };

function fontSizeOf(text: string): number | undefined {
  return (StyleSheet.flatten(screen.getByText(text).props.style) as TextStyle).fontSize;
}

function problem(): Problem {
  return {
    id: 'd1e2f3a4-1111-4111-8111-d1e2f3a40001',
    property_id: 412432,
    task_id: null,
    reported_by: ME,
    title: 'Кран течёт',
    description: null,
    priority: 'normal',
    status: 'open',
    resolved_at: null,
    cancelled_at: null,
    cancel_reason: null,
    created_at: '2026-11-10T08:00:00+00:00',
    property: { name: 'CZ - Nadrazni Apt 6', hostaway_unit_id: null, parent: null },
  } as Problem;
}

function request(): SupplyRequest {
  return {
    id: 'b7c8d9e0-3333-4333-8333-b7c8d9e00001',
    requested_by: ME,
    property_id: 412432,
    task_id: null,
    status: 'new',
    priority: 'normal',
    note: null,
    needed_by: null,
    reviewed_at: null,
    fulfilled_at: null,
    reject_reason: null,
    created_at: '2026-11-10T08:00:00+00:00',
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
  } as SupplyRequest;
}

describe('her reports', () => {
  test('a failed refresh keeps the list, with the failure said above it', async () => {
    await render(
      <ProblemList
        {...listProps}
        sections={[{ key: 'active', data: [problem()] }]}
        error={new Error('Network request failed')}
      />,
    );

    expect(screen.getByText('Кран течёт')).toBeTruthy();
    expect(screen.getByText(STALE)).toBeTruthy();
    expect(screen.getByText(GENERAL)).toBeTruthy();
    expect(screen.getByText('Network request failed')).toBeTruthy();
  });

  test('a list that never loaded is still the error screen', async () => {
    await render(
      <ProblemList {...listProps} sections={undefined} error={new Error('Network request failed')} />,
    );

    expect(screen.getByText(GENERAL)).toBeTruthy();
    expect(screen.queryByText(STALE)).toBeNull();
  });

  test('the error screen says the sentence first and the server’s words small under it', async () => {
    await render(
      <ProblemList {...listProps} sections={undefined} error={new Error('Network request failed')} />,
    );

    expect(fontSizeOf(GENERAL)).toBe(FontSize.body);
    expect(fontSizeOf('Network request failed')).toBe(FontSize.caption);
  });

  test('an empty list whose refresh failed says both: nothing here, and the failure above', async () => {
    await render(<ProblemList {...listProps} sections={[]} error={new Error('Network request failed')} />);

    expect(screen.getByText('Заданий не заявлено')).toBeTruthy();
    expect(screen.getByText(STALE)).toBeTruthy();
    expect(screen.getByText('Network request failed')).toBeTruthy();
  });
});

describe('her supply requests', () => {
  test('a failed refresh keeps the list, with the failure said above it', async () => {
    await render(
      <SupplyList
        {...listProps}
        sections={[{ key: 'active', data: [request()] }]}
        error={new Error('Network request failed')}
      />,
    );

    expect(screen.getByText(/Мешки для мусора/)).toBeTruthy();
    expect(screen.getByText(STALE)).toBeTruthy();
    expect(screen.getByText('Network request failed')).toBeTruthy();
  });

  test('a list that never loaded is still the error screen', async () => {
    await render(
      <SupplyList {...listProps} sections={undefined} error={new Error('Network request failed')} />,
    );

    expect(screen.getByText(GENERAL)).toBeTruthy();
    expect(screen.queryByText(STALE)).toBeNull();
  });

  test('the error screen says the sentence first and the server’s words small under it', async () => {
    await render(
      <SupplyList {...listProps} sections={undefined} error={new Error('Network request failed')} />,
    );

    expect(fontSizeOf(GENERAL)).toBe(FontSize.body);
    expect(fontSizeOf('Network request failed')).toBe(FontSize.caption);
  });

  test('an empty list whose refresh failed says both: nothing here, and the failure above', async () => {
    await render(<SupplyList {...listProps} sections={[]} error={new Error('Network request failed')} />);

    expect(screen.getByText('Заявок нет')).toBeTruthy();
    expect(screen.getByText(STALE)).toBeTruthy();
    expect(screen.getByText('Network request failed')).toBeTruthy();
  });
});
