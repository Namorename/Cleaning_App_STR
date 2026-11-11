import {
  formatGuestDate,
  guestOriginLines,
  needsPmsSearch,
  readGuestOrigin,
  type GuestOrigin,
} from '@str-ops/shared';
import { describe, expect, test } from 'vitest';

import { i18n } from '@/lib/i18n';

const ru = (key: string, options?: Record<string, string>) => i18n.getFixedT('ru')(key, options);
const lines = (origin: GuestOrigin, language = 'ru') =>
  guestOriginLines(origin, (key, options) => i18n.getFixedT(language)(key, options), language).map(
    (line) => line.text,
  );

// What problem_guest_origin answers each role (20261111120000): the phone and the panel say the
// lines of whatever came, and nothing of what did not.
const stay = { precision: 'day', arrival: '2026-10-03', departure: '2026-10-07' } as const;
const technician = { source: 'review', stay } as const;
const headTechnician = {
  ...technician,
  channel: 'airbnb',
  guest: { state: 'shown', name: 'Synthetic Guest' },
  rating: 6,
  sent: { precision: 'day', on: '2026-10-09' },
} as const;
const office = {
  ...headTechnician,
  booking_id: '900111011',
  conversation_id: null,
  signal_id: '88888888-8888-4888-8888-888888888888',
  has_text: true,
} as const;
const day = (value: string) => formatGuestDate(value, 'day', 'ru');

describe('the lines of a task from a guest', () => {
  test('the technician and the maid: the stay alone, never a name', () => {
    const origin = readGuestOrigin(technician);
    expect(origin).not.toBeNull();
    expect(lines(origin!)).toEqual([`Проживание: ${day('2026-10-03')} – ${day('2026-10-07')}`]);
    expect(lines(origin!).join(' ')).not.toMatch(/Гость/);
  });

  test('the technician on a decided card: the months, and why they are months', () => {
    const origin = readGuestOrigin({
      source: 'message',
      stay: { precision: 'month', arrival: '2026-09', departure: '2026-10' },
    });
    expect(lines(origin!)).toEqual([
      'Проживание: сентябрь 2026 г. – октябрь 2026 г.',
      'Точные даты не хранятся после решения по карточке',
    ]);
  });

  test('the head technician: the name, the channel and the rating, the day — no numbers', () => {
    const origin = readGuestOrigin(headTechnician)!;
    expect(lines(origin)).toEqual([
      `Проживание: ${day('2026-10-03')} – ${day('2026-10-07')}`,
      'Гость: Synthetic Guest',
      'Airbnb · оценка 6/10',
      `Отзыв от ${day('2026-10-09')}`,
    ]);
    expect(needsPmsSearch(origin)).toBe(false);
  });

  test('the office: the numbers to find it in Hostaway', () => {
    const origin = readGuestOrigin({ ...office, conversation_id: '7001' })!;
    expect(lines(origin).slice(-2)).toEqual(['Бронь в PMS № 900111011', 'Разговор в PMS № 7001']);
    expect(needsPmsSearch(origin)).toBe(true);
  });

  test.each([
    ['erased', 'Имя удалено по сроку хранения'],
    ['cut', 'Имя и точные даты не хранятся после решения по карточке'],
    ['none', 'Бронь не найдена, имени нет'],
  ])('a name that is not there says why: %s', (state, words) => {
    const origin = readGuestOrigin({ ...headTechnician, guest: { state, name: null } })!;
    const guest = guestOriginLines(origin, ru, 'ru').find((line) => line.key === 'guest');
    expect(guest).toEqual({ key: 'guest', text: words, muted: true });
  });

  test('a chat has no rating, and says when the message was sent', () => {
    const origin = readGuestOrigin({ ...headTechnician, source: 'message', rating: null })!;
    expect(lines(origin)).toContain('Airbnb');
    expect(lines(origin)).toContain(`Сообщение от ${day('2026-10-09')}`);
  });

  test('no stay named by the PMS: says the dates are unknown', () => {
    expect(lines(readGuestOrigin({ source: 'review', stay: null })!)).toEqual([
      'Даты проживания неизвестны',
    ]);
  });

  test.each([
    ['en', 'Stay: 3 Oct 2026 – 7 Oct 2026', 'Guest: Synthetic Guest', 'Airbnb · rating 6/10'],
    ['cs', 'Pobyt: 3. 10. 2026 – 7. 10. 2026', 'Host: Synthetic Guest', 'Airbnb · hodnocení 6/10'],
  ])('in %s the lines are its own', (language, stayLine, guestLine, channelLine) => {
    expect(lines(readGuestOrigin(headTechnician)!, language).slice(0, 3)).toEqual([
      stayLine,
      guestLine,
      channelLine,
    ]);
  });
});

describe('reading the answer', () => {
  test('no answer about a guest is no block', () => {
    expect(readGuestOrigin(null)).toBeNull();
    expect(readGuestOrigin({ source: 'staff' })).toBeNull();
    expect(readGuestOrigin('review')).toBeNull();
  });

  test('a key the server left out stays out: a role is never given more than it was sent', () => {
    expect(readGuestOrigin(technician)).toEqual({ source: 'review', stay });
  });

  test('a value spelt otherwise costs its line, not the block', () => {
    const origin = readGuestOrigin({
      source: 'review',
      stay: { precision: 'week', arrival: '2026-10-03', departure: '2026-10-07' },
      guest: { state: 'shown', name: '  ' },
      sent: { precision: 'day' },
      rating: '6',
    })!;
    expect(origin.stay).toBeNull();
    expect(origin.guest).toEqual({ state: 'none', name: null });
    expect(origin.sent).toBeNull();
    expect(origin.rating).toBeNull();
  });
});
