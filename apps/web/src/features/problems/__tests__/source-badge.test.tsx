import { ICONS, SIGNAL_SOURCE_LOOK, STATUS_TONE } from '@str-ops/shared';
import { render, screen, within } from '@testing-library/react';
import { icons } from 'lucide-react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { i18n } from '@/lib/i18n';

import { ProblemCard } from '../problem-card';
import { ProblemsTable } from '../problems-table';
import { problemSchema, type Problem } from '../schema';
import { SOURCE_GLYPH_NAMES, SOURCE_GLYPHS, SourceBadge } from '../source-badge';

vi.mock('@/features/chat/use-chat', () => ({
  useUnreadSubjects: () => ({ tasks: new Set<string>(), problems: new Set<string>() }),
}));

const base = {
  property_id: 1,
  task_id: null,
  description: null,
  priority: 'normal',
  status: 'open',
  resolved_at: null,
  cancelled_at: null,
  cancel_reason: null,
  created_at: '2026-11-10T10:00:00+00:00',
  property: { name: 'Vinohrady 12' },
  fix_tasks: [],
};

const fromReview: Problem = problemSchema.parse({
  ...base,
  id: '11111111-1111-4111-8111-111111111111',
  reported_by: null,
  reporter: null,
  title: 'Нет горячей воды',
  source: 'review',
  source_facts: { kind: 'repair', subject: 'hot_water', channel: 'airbnb', period_month: '2026-10' },
});
const fromChat: Problem = problemSchema.parse({
  ...base,
  id: '22222222-2222-4222-8222-222222222222',
  reported_by: null,
  reporter: null,
  title: 'Не работает отопление',
  source: 'message',
  source_facts: { kind: 'repair', subject: 'heating', channel: 'booking', period_month: '2026-11' },
});
const fromStaff: Problem = problemSchema.parse({
  ...base,
  id: '33333333-3333-4333-8333-333333333333',
  reported_by: '44444444-4444-4444-8444-444444444444',
  reporter: { full_name: 'Maria Test' },
  title: 'Сломан замок',
});

/** `user-round-check` → `UserRoundCheck`, the name Lucide exports the component under. */
function componentName(name: string): string {
  return name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

afterEach(async () => {
  await i18n.changeLanguage('ru');
});

// The owner's word of 2026-11-11: a task from a guest's review and one from a chat part at a
// glance — the glyph, the colour and the word, each enough on its own.
describe('the source chip', () => {
  test('a review: the star, the gold tone filled, «Из отзыва»', () => {
    render(<SourceBadge source="review" />);
    const chip = screen.getByText('Из отзыва').closest('[data-source]');
    expect(chip).toHaveAttribute('data-source', 'review');
    expect(chip?.className).toContain('bg-tone-today-mark');
    expect(chip?.className).toContain('text-tone-today-on-mark');
    expect(chip?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  test('a chat: the bubble, the booking’s terracotta filled, «Из чата»', () => {
    render(<SourceBadge source="message" />);
    const chip = screen.getByText('Из чата').closest('[data-source]');
    expect(chip).toHaveAttribute('data-source', 'message');
    expect(chip?.className).toContain('bg-tone-booking-mark');
    expect(chip?.className).toContain('text-tone-booking-on-mark');
  });

  test('nothing for the staff, nothing for a source this build does not know', () => {
    const { container } = render(
      <>
        <SourceBadge source="staff" />
        <SourceBadge source="email" />
        <SourceBadge source={null} />
      </>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test('the two tones are the shared map’s, and neither is a status of a task', () => {
    expect(SIGNAL_SOURCE_LOOK.review.tone).toBe(STATUS_TONE['problems.source.review']);
    expect(SIGNAL_SOURCE_LOOK.message.tone).toBe(STATUS_TONE['problems.source.message']);
    const taskTones = Object.entries(STATUS_TONE)
      .filter(([key]) => /^problems\.(open|assigned|in_progress|resolved|cancelled|priority\.)/.test(key))
      .map(([, tone]) => tone);
    expect(taskTones).not.toContain(SIGNAL_SOURCE_LOOK.review.tone);
    expect(taskTones).not.toContain(SIGNAL_SOURCE_LOOK.message.tone);
    expect(SIGNAL_SOURCE_LOOK.review.tone).not.toBe(SIGNAL_SOURCE_LOOK.message.tone);
  });

  test('each glyph is the canonical Lucide icon the shared map names', () => {
    expect(SOURCE_GLYPH_NAMES).toEqual({
      review: ICONS['source.review'],
      message: ICONS['source.message'],
    });
    for (const source of ['review', 'message'] as const) {
      expect(icons[componentName(SOURCE_GLYPH_NAMES[source]) as keyof typeof icons]).toBe(
        SOURCE_GLYPHS[source],
      );
    }
  });

  test.each([
    ['en', 'From a review', 'From a chat'],
    ['cs', 'Z recenze', 'Z chatu'],
    ['ru', 'Из отзыва', 'Из чата'],
  ])('in %s the words are its own', async (language, review, chat) => {
    await i18n.changeLanguage(language);
    render(
      <>
        <SourceBadge source="review" />
        <SourceBadge source="message" />
      </>,
    );
    expect(screen.getByText(review)).toBeInTheDocument();
    expect(screen.getByText(chat)).toBeInTheDocument();
  });
});

describe('the chip where a task is shown', () => {
  test('on the board: a review’s card and a chat’s card, and none on the staff’s', () => {
    render(
      <>
        <ProblemCard problem={fromReview} />
        <ProblemCard problem={fromChat} />
        <ProblemCard problem={fromStaff} />
      </>,
    );
    const [review, chat, staff] = screen.getAllByRole('article');
    expect(within(review).getByText('Из отзыва')).toBeInTheDocument();
    expect(within(chat).getByText('Из чата')).toBeInTheDocument();
    expect(within(staff).queryByText(/^Из (отзыва|чата)$/)).not.toBeInTheDocument();
  });

  test('in the table: the chip before the title, and the guest where the reporter would stand', () => {
    render(<ProblemsTable problems={[fromReview, fromChat, fromStaff]} />);
    const [, review, chat, staff] = screen.getAllByRole('row');
    expect(within(review).getByText('Из отзыва')).toBeInTheDocument();
    expect(within(review).getByText('Из отзыва гостя')).toBeInTheDocument();
    expect(within(chat).getByText('Из чата')).toBeInTheDocument();
    expect(within(chat).getByText('Из сообщения гостя')).toBeInTheDocument();
    expect(within(staff).queryByText(/^Из /)).not.toBeInTheDocument();
    expect(within(staff).getByText('Maria Test')).toBeInTheDocument();
  });
});
