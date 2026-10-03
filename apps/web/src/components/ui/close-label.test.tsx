import { act, render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { Dialog, DialogContent, DialogFooter, DialogTitle } from './dialog';
import { Sheet, SheetContent, SheetTitle } from './sheet';
import { toast, Toaster } from './toast';

/**
 * The cross of a dialog, a sheet and a toast is an icon; a screen reader reads
 * its hidden label, which shadcn writes in English. In the panel it is a key
 * in three languages (the plan's decision 8); the tests run in Russian.
 */
describe('the close button', () => {
  test('of a dialog reads «Закрыть», and so does the footer’s', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Уборка</DialogTitle>
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>,
    );

    expect(screen.getAllByRole('button', { name: 'Закрыть' })).toHaveLength(2);
    expect(screen.queryByText('Close')).not.toBeInTheDocument();
  });

  test('of a sheet reads «Закрыть»', () => {
    render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>Объекты</SheetTitle>
        </SheetContent>
      </Sheet>,
    );

    expect(screen.getByRole('button', { name: 'Закрыть' })).toBeInTheDocument();
  });

  test('of a toast reads «Закрыть»', async () => {
    render(<Toaster />);

    await act(async () => {
      toast.add({ title: 'Сохранено' });
    });

    expect(await screen.findByText('Сохранено')).toBeInTheDocument();
    // Base UI keeps a toast's cross out of the reader's tree (aria-hidden): the
    // toast is announced by its live region and closes by Escape or a swipe.
    expect(document.querySelector('[data-slot="toast-close"]')).toHaveAttribute(
      'aria-label',
      'Закрыть',
    );
  });
});
