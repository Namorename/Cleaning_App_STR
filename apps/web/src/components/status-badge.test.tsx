import { ICONS, type IconMeaning } from '@str-ops/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { STATUS_GLYPH_MEANINGS, StatusBadge, StatusGlyph } from './status-badge';

describe('the glyph of a status', () => {
  test.each(STATUS_GLYPH_MEANINGS)('%s is the icon the shared map names', (meaning) => {
    const { container } = render(<StatusGlyph meaning={meaning} />);

    const icon = container.querySelector('svg');
    expect(icon).toHaveClass(`lucide-${ICONS[meaning]}`);
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  test('covers every status glyph of the map', () => {
    const inMap = (Object.keys(ICONS) as IconMeaning[]).filter((meaning) =>
      meaning.startsWith('status.'),
    );
    expect([...STATUS_GLYPH_MEANINGS].sort()).toEqual(inMap.sort());
  });

  // ICON_STYLE: «Назначено» is a filled person, «Без исполнителя» a dashed
  // one, «В работе» a filled ▶ — told apart by shape, not by colour alone.
  test('draws the person of «nobody» dashed and the one of «assigned» filled', () => {
    const { container } = render(
      <>
        <StatusGlyph meaning="status.nobody" />
        <StatusGlyph meaning="status.assigned" />
        <StatusGlyph meaning="status.inProgress" />
      </>,
    );

    const [nobody, assigned, inProgress] = container.querySelectorAll('svg');
    expect(nobody).toHaveAttribute('stroke-dasharray');
    expect(nobody).toHaveAttribute('fill', 'none');
    expect(assigned).toHaveAttribute('fill', 'currentColor');
    expect(inProgress).toHaveAttribute('fill', 'currentColor');
  });
});

describe('StatusBadge', () => {
  test('wears the tone of its status and carries its glyph before the words', () => {
    render(<StatusBadge status="problems.in_progress">В работе</StatusBadge>);

    const badge = screen.getByText('В работе');
    expect(badge).toHaveClass('bg-tone-in-progress-bg');
    expect(badge.querySelector('svg')).toHaveClass('lucide-play');
  });

  test('a status whose word stands alone has no glyph', () => {
    render(<StatusBadge status="problems.priority.normal">Обычная</StatusBadge>);

    expect(screen.getByText('Обычная').querySelector('svg')).toBeNull();
  });
});
