import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { Badge } from './badge';

/**
 * A status badge takes its tone from the contract (`STATUS_TONE`, 5.2): the
 * colours change, the badge does not — the same pill, the same height, the
 * same words.
 */
describe('Badge', () => {
  test('a tone paints the badge in the tone’s fill and words, and keeps its shape', () => {
    render(<Badge tone="assigned">Назначена</Badge>);

    const badge = screen.getByText('Назначена');
    expect(badge).toHaveClass('bg-tone-assigned-bg', 'text-tone-assigned-fg', 'h-5', 'rounded-4xl');
    expect(badge).not.toHaveClass('bg-primary');
  });

  test('«Без исполнителя» wears its dashed frame', () => {
    render(<Badge tone="unassigned">Без исполнителя</Badge>);

    expect(screen.getByText('Без исполнителя')).toHaveClass(
      'border-dashed',
      'border-tone-unassigned-border',
    );
  });

  test('without a tone a badge is what its variant says', () => {
    render(<Badge variant="outline">Уборка</Badge>);

    expect(screen.getByText('Уборка')).toHaveClass('border-border', 'text-foreground');
  });
});
