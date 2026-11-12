import { render, screen, within } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { ProblemPhotos, type ShownMedia } from '../problem-photos';

/**
 * The files of a report or of a repair step, each drawn as a thumbnail that
 * opens the panel's viewer: a photo as its picture, a video as its length
 * over a play mark, and a photo storage would not sign as a line saying so.
 * None of them is a link to a new tab any more (2026-11-12).
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
  test('draws each file as a thumbnail that opens the viewer', () => {
    render(
      <ProblemPhotos
        media={[
          file({}),
          file({
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002',
            storage_path: 'h/p/b.mp4',
            kind: 'video',
            duration_sec: 65,
            url: null,
          }),
          file({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003', url: null }),
        ]}
        emptyText="Фото нет"
        title="Видео после работы"
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Открыть фото 1 из 3' }).querySelector('img'),
    ).toHaveAttribute('src', 'https://signed/h/p/a.jpg');
    // A video is a tile: nothing of the file is loaded until it is opened.
    expect(
      within(screen.getByRole('button', { name: 'Открыть видео 2 из 3' })).getByText('1:05'),
    ).toBeInTheDocument();
    expect(document.querySelector('video')).toBeNull();
    // The photo storage would not sign: said as the task drawer says it — not
    // «Фото нет», which reads as no photo taken.
    expect(screen.getByRole('button', { name: 'Открыть фото 3 из 3' })).toHaveTextContent(
      'Фото недоступно',
    );
    expect(document.querySelector('a')).toBeNull();
  });

  test('says there is nothing to show when there is nothing', () => {
    render(<ProblemPhotos media={[]} emptyText="Фото к заданию нет" />);

    expect(screen.getByText('Фото к заданию нет')).toBeInTheDocument();
  });
});
