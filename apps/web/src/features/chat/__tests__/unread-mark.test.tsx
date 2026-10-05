import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

import { UnreadBadge, UnreadChatButton, UnreadChatLink } from '../unread-mark';

const HREF = '/problems/11111111-1111-4111-8111-111111111111?view=list&chat=1';

describe('the mark «Новое сообщение»', () => {
  test('is the badge of the unread tone the board cards wear', () => {
    render(<UnreadBadge />);

    expect(screen.getByText('Новое сообщение')).toHaveClass('bg-tone-unread-mark');
  });

  // 5.4, «Чат»: in a list the mark is a way into the conversation, not a sign
  // to go and look for it.
  // The review of 05.10: every mark of a list had the same name, and a reader
  // listing the links heard «открыть разговор» over and over. Each names its own.
  test('as a link, leads to the conversation and says whose', () => {
    render(<UnreadChatLink href={HREF} about="Течёт кран" />);

    const link = screen.getByRole('link', {
      name: 'Новое сообщение — открыть разговор: Течёт кран',
    });
    expect(link).toHaveAttribute('href', HREF);
    expect(link).toHaveTextContent('Новое сообщение');
    expect(link).toHaveClass('min-h-11');
  });

  test('as a button, opens the conversation in place', async () => {
    const onOpen = vi.fn();
    render(<UnreadChatButton onOpen={onOpen} about="Генеральная уборка · Vinohrady 12" />);

    const button = screen.getByRole('button', {
      name: 'Новое сообщение — открыть разговор: Генеральная уборка · Vinohrady 12',
    });
    expect(button).toHaveClass('min-h-11');
    await userEvent.click(button);

    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
