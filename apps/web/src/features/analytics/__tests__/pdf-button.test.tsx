import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { i18n } from '@/lib/i18n';

import { PdfButton } from '../pdf-button';

const downloadAnalyticsPdf = vi.fn();
vi.mock('../pdf/download', () => ({
  downloadAnalyticsPdf: (...args: unknown[]) => downloadAnalyticsPdf(...args),
}));

const REQUEST = { marker: 'the page as it is' };

beforeEach(async () => {
  await i18n.changeLanguage('en');
  downloadAnalyticsPdf.mockReset();
});

afterEach(async () => {
  await i18n.changeLanguage('ru');
});

describe('PdfButton', () => {
  test('one press makes the PDF of the page as it is', async () => {
    downloadAnalyticsPdf.mockResolvedValue(undefined);
    const request = vi.fn(() => REQUEST as never);
    render(<PdfButton request={request} disabled={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));

    await waitFor(() => expect(downloadAnalyticsPdf).toHaveBeenCalledTimes(1));
    expect(downloadAnalyticsPdf).toHaveBeenCalledWith(REQUEST);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download PDF' })).toBeEnabled());
  });

  test('while the PDF is made the button says so and takes no second press', async () => {
    let finish: () => void = () => {};
    downloadAnalyticsPdf.mockImplementation(
      () => new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    render(<PdfButton request={() => REQUEST as never} disabled={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));

    const busy = await screen.findByRole('button', { name: 'Preparing the PDF…' });
    expect(busy).toBeDisabled();
    // Said aloud too: a button that goes disabled loses the keyboard's focus.
    expect(screen.getByRole('status')).toHaveTextContent('Preparing the PDF…');
    fireEvent.click(busy);
    expect(downloadAnalyticsPdf).toHaveBeenCalledTimes(1);
    finish();
    await screen.findByRole('button', { name: 'Download PDF' });
  });

  test('a PDF that could not be made is said so, and the button is ready again', async () => {
    downloadAnalyticsPdf.mockRejectedValue(new Error('font fetch failed'));
    render(<PdfButton request={() => REQUEST as never} disabled={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));

    expect(await screen.findByText('The PDF could not be made')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeEnabled();
  });

  test('nothing to make before the figures have loaded', () => {
    render(<PdfButton request={() => REQUEST as never} disabled />);
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('listings or a team that did not load: it says why, and a press loads them again', () => {
    const retry = vi.fn();
    render(
      <PdfButton
        request={() => REQUEST as never}
        disabled
        lookupsFailed={{ error: new Error('Failed to fetch'), retry, isRetrying: false }}
      />,
    );

    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The report needs the listings and the people, and they did not load.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(downloadAnalyticsPdf).not.toHaveBeenCalled();
  });

  test('while they load again it says so aloud, keeps the focus and takes no second press', () => {
    const retry = vi.fn();
    render(
      <PdfButton
        request={() => REQUEST as never}
        disabled
        lookupsFailed={{ error: new Error('Failed to fetch'), retry, isRetrying: true }}
      />,
    );

    const again = screen.getByRole('button', { name: 'Loading…' });
    // Not disabled: a disabled button drops the keyboard's focus.
    expect(again).toBeEnabled();
    expect(again).toHaveAttribute('aria-disabled', 'true');
    again.focus();
    fireEvent.click(again);
    expect(retry).not.toHaveBeenCalled();
    expect(again).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
  });

  test.each([
    ['cs', 'Report potřebuje objekty a pracovníky a ty se nepodařilo načíst.', 'Zkusit znovu'],
    ['ru', 'Для отчёта нужны объекты и сотрудники, а они не загрузились.', 'Повторить'],
  ])('says why in %s too', async (language, why, again) => {
    await i18n.changeLanguage(language);
    render(
      <PdfButton
        request={() => REQUEST as never}
        disabled
        lookupsFailed={{ error: new Error('Failed to fetch'), retry: vi.fn(), isRetrying: false }}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(why);
    expect(screen.getByRole('button', { name: again })).toBeEnabled();
  });
});
