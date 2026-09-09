import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { supplyRequestSchema, type SupplyRequest } from '../schema';

const NEW_ID = '11111111-1111-4111-8111-111111111111';
const NEW_2_ID = '55555555-5555-4555-8555-555555555555';
const DONE_ID = '33333333-3333-4333-8333-333333333333';

const base = {
  requested_by: '22222222-2222-4222-8222-222222222222',
  property_id: 1,
  task_id: null,
  priority: 'normal',
  note: null,
  needed_by: null,
  reviewed_at: null,
  fulfilled_at: null,
  reject_reason: null,
  created_at: '2026-09-09T10:00:00+00:00',
  property: { name: 'Vinohrady 12' },
  requester: { full_name: 'Maria Test' },
};

const item = (id: string, name: string, quantity: number, unit = 'pcs', sort_order = 1) => ({
  id,
  name,
  quantity,
  unit,
  comment: null,
  sort_order,
});

const requests: SupplyRequest[] = [
  supplyRequestSchema.parse({
    ...base,
    id: NEW_ID,
    status: 'new',
    priority: 'urgent',
    items: [
      item('aaaaaaaa-aaaa-4aaa-8aaa-000000000001', 'Средство для стёкол', 2),
      item('aaaaaaaa-aaaa-4aaa-8aaa-000000000002', 'Мешки для мусора', 1, 'pack', 2),
    ],
  }),
  supplyRequestSchema.parse({
    ...base,
    id: NEW_2_ID,
    status: 'new',
    property: { name: 'Karlín 3' },
    items: [item('aaaaaaaa-aaaa-4aaa-8aaa-000000000003', 'средство для стёкол', 3)],
  }),
  supplyRequestSchema.parse({
    ...base,
    id: DONE_ID,
    status: 'fulfilled',
    fulfilled_at: '2026-09-08T12:00:00+00:00',
    items: [item('aaaaaaaa-aaaa-4aaa-8aaa-000000000004', 'Губки', 10)],
  }),
];

const useSupplyRequests = vi.fn();
const review = vi.fn();
vi.mock('../use-supplies', () => ({
  useSupplyRequests: () => useSupplyRequests(),
  useReviewSupplyRequest: () => ({
    mutate: review,
    isPending: false,
    isError: false,
    error: null,
  }),
}));

const downloadFile = vi.fn();
vi.mock('@/lib/download', () => ({ downloadFile: (...args: unknown[]) => downloadFile(...args) }));

import { SuppliesView } from '../supplies-view';

/** jsdom's Blob has no text(); the reader route works there and in browsers alike. */
const readBlob = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });

beforeEach(() => {
  vi.clearAllMocks();
  useSupplyRequests.mockReturnValue({ data: requests, isPending: false, isError: false });
});

describe('SuppliesView', () => {
  test('opens on the new requests with their lines, and switches tabs', async () => {
    render(<SuppliesView />);

    expect(screen.getByRole('tab', { name: /Новые/ })).toHaveTextContent('2');
    expect(screen.getByText('Средство для стёкол')).toBeInTheDocument();
    expect(screen.getByText('1 упак')).toBeInTheDocument();
    expect(screen.getByText('Срочно')).toBeInTheDocument();
    expect(screen.queryByText('Губки')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /Выполненные/ }));
    expect(screen.getByText('Губки')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Принять' })).not.toBeInTheDocument();
  });

  test('accepts at once and rejects only with a reason', async () => {
    render(<SuppliesView />);
    const card = screen.getByText('Karlín 3').closest('[data-slot="card"]') as HTMLElement;

    await userEvent.click(within(card).getByRole('button', { name: 'Принять' }));
    expect(review).toHaveBeenCalledWith({ requestId: NEW_2_ID, status: 'accepted' });

    await userEvent.click(within(card).getByRole('button', { name: 'Отклонить' }));
    const confirm = within(card).getByRole('button', { name: 'Подтвердить отказ' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(card).getByLabelText('Причина отказа'), 'Есть на складе');
    await userEvent.click(confirm);
    expect(review).toHaveBeenCalledWith(
      { requestId: NEW_2_ID, status: 'rejected', rejectReason: 'Есть на складе' },
      expect.anything(),
    );
  });

  test('sums the same item across requests and hands over a CSV and an XLSX', async () => {
    render(<SuppliesView />);

    await userEvent.click(screen.getByRole('button', { name: 'Свести к закупке' }));
    const dialog = await screen.findByRole('dialog');
    const row = within(dialog).getByText('Средство для стёкол').closest('tr') as HTMLElement;
    expect(row).toHaveTextContent('5');
    expect(row).toHaveTextContent('Vinohrady 12; Karlín 3');
    expect(within(dialog).queryByText('Губки')).not.toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Скачать CSV' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Скачать XLSX' }));
    const names = downloadFile.mock.calls.map((call) => call[0]);
    expect(names[0]).toMatch(/^purchase-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(names[1]).toMatch(/^purchase-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(await readBlob(downloadFile.mock.calls[0]?.[1] as Blob)).toContain(
      'Средство для стёкол,шт,5,Vinohrady 12; Karlín 3,2',
    );
  });
});
