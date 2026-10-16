import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { ProblemPhotos, type ShownMedia } from '../problem-photos';

/**
 * The files of a report or of a repair step, each drawn as what it is: a photo
 * as a picture that opens larger, a video as a player, and a file storage
 * would not sign as a line saying so.
 */

const file = (overrides: Partial<ShownMedia>): ShownMedia => ({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
  step_id: null,
  storage_path: 'h/p/a.jpg',
  created_at: '2026-10-09T09:00:00+00:00',
  source: 'camera',
  url: 'https://signed/h/p/a.jpg',
  ...overrides,
});

describe('ProblemPhotos', () => {
  test('draws each file as what it is', () => {
    render(
      <ProblemPhotos
        media={[
          file({}),
          file({
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002',
            kind: 'video',
            duration_sec: 65,
            url: 'https://signed/h/p/b.mp4',
          }),
          file({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003', url: null }),
        ]}
        emptyText="Фото нет"
        videoLabel="Видео после работы"
      />,
    );

    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://signed/h/p/a.jpg');
    expect(screen.getByLabelText('Видео: Видео после работы')).toHaveAttribute(
      'src',
      'https://signed/h/p/b.mp4',
    );
    // The photo storage would not sign: said as the task drawer says it, and
    // as a video says it — not «Фото нет», which reads as no photo taken.
    expect(screen.getByText('Фото недоступно')).toBeInTheDocument();
  });

  test('says there is nothing to show when there is nothing', () => {
    render(<ProblemPhotos media={[]} emptyText="Фото к заданию нет" />);

    expect(screen.getByText('Фото к заданию нет')).toBeInTheDocument();
  });
});
