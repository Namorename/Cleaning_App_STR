import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { formatVideoDuration, groupByStep, stepMediaListSchema } from '../schema';
import { VideoTile } from '../video-tile';

const URL = 'https://project.supabase.co/storage/v1/object/sign/task-media/a.mp4?token=t';

describe('formatVideoDuration', () => {
  test('reads seconds as minutes and seconds', () => {
    expect(formatVideoDuration(65)).toBe('1:05');
    expect(formatVideoDuration(120)).toBe('2:00');
    expect(formatVideoDuration(9)).toBe('0:09');
  });

  test('rounds the phone timer to a whole second', () => {
    expect(formatVideoDuration(64.6)).toBe('1:05');
  });

  test('says nothing when the length is not known', () => {
    expect(formatVideoDuration(null)).toBeNull();
    expect(formatVideoDuration(-1)).toBeNull();
    expect(formatVideoDuration(Number.NaN)).toBeNull();
  });
});

describe('the media of a step, as the server hands it over', () => {
  const row = {
    id: 'm1',
    step_id: 's1',
    storage_path: 'h/t/s1/m1.mp4',
    created_at: '2026-10-09T08:00:00+00:00',
    source: 'camera',
    kind: 'video',
    duration_sec: 65,
  };

  test('keeps the kind and the length', () => {
    const [media] = stepMediaListSchema.parse([row]);

    expect(media.kind).toBe('video');
    expect(media.duration_sec).toBe(65);
  });

  // The column is an enum of two today; a third value must not blank the steps.
  test('reads a kind it does not know as a photo rather than failing the list', () => {
    const [media] = stepMediaListSchema.parse([{ ...row, kind: 'document', duration_sec: 'x' }]);

    expect(media.kind).toBe('photo');
    expect(media.duration_sec).toBeNull();
  });

  test('groups by step, in the order it came, and leaves out what has no step', () => {
    const groups = groupByStep([
      { id: 'a', step_id: 's1' },
      { id: 'b', step_id: null },
      { id: 'c', step_id: 's2' },
      { id: 'd', step_id: 's1' },
    ]);

    expect(groups).toEqual({
      s1: [
        { id: 'a', step_id: 's1' },
        { id: 'd', step_id: 's1' },
      ],
      s2: [{ id: 'c', step_id: 's2' }],
    });
  });
});

describe('VideoTile', () => {
  test('plays the signed link with the browser controls, loading only its metadata', () => {
    render(<VideoTile url={URL} durationSec={65} label="Видео: Видео после работы" />);

    const video = screen.getByLabelText('Видео: Видео после работы');
    expect(video.tagName).toBe('VIDEO');
    expect(video).toHaveAttribute('src', URL);
    expect(video).toHaveAttribute('controls');
    expect(video).toHaveAttribute('preload', 'metadata');
    // iPhone Safari would otherwise take the manager full screen on play.
    expect(video).toHaveAttribute('playsinline');
  });

  test('says how long it is', () => {
    render(<VideoTile url={URL} durationSec={65} label="Видео" />);

    expect(screen.getByText('Видео · 1:05')).toBeInTheDocument();
  });

  test('says only that it is a video when the length is not known', () => {
    render(<VideoTile url={URL} durationSec={null} label="Видео 1" />);

    expect(screen.getByText('Видео')).toBeInTheDocument();
  });

  test('opens larger in a new tab, as a photo does', () => {
    render(<VideoTile url={URL} durationSec={65} label="Видео" />);

    const link = screen.getByRole('link', { name: 'Открыть видео в новой вкладке' });
    expect(link).toHaveAttribute('href', URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });
});
