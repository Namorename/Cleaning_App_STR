import { SIGNAL_SOURCE_LOOK, type GuestSource } from '@str-ops/shared';
import { isHiddenFromAccessibility, render, screen } from '@testing-library/react-native';
import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { i18n } from '@/i18n';

import { SourceBadge } from '../source-badge';

/**
 * Where a task from a guest came from, at a glance (owner, 2026-11-11): the
 * review's star on gold, «Из отзыва»; the chat's bubble on terracotta, «Из
 * чата». Filled with the tone's mark, its glyph and word in `onMark` — never a
 * status chip's tint, never colour alone.
 */

jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: jest.fn(() => 'light') }));
const scheme = jest.mocked(useColorScheme);

beforeEach(() => {
  scheme.mockReturnValue('light');
});

afterEach(async () => {
  await i18n.changeLanguage('ru');
});

function styleOf(element: { props: { style?: unknown } }): ViewStyle & TextStyle {
  return StyleSheet.flatten(element.props.style as ViewStyle) as ViewStyle & TextStyle;
}

/** What Lucide handed the drawing inside the chip's icon box. */
function drawing(): Readonly<Record<string, unknown>> {
  const box = screen.getByTestId('chip-icon', { includeHiddenElements: true });
  const [glyph] = box.children;
  if (glyph === undefined || typeof glyph === 'string') {
    throw new Error('the chip holds no glyph');
  }
  return glyph.props;
}

const KINDS: readonly (readonly [GuestSource, string, string])[] = [
  ['review', 'Из отзыва', 'star'],
  ['message', 'Из чата', 'message-square'],
];

describe.each(KINDS)('a task from a %s', (source, word, glyph) => {
  const tone = SIGNAL_SOURCE_LOOK[source].tone;

  test(`says «${word}» beside the ${glyph} glyph`, async () => {
    await render(<SourceBadge testID="chip" source={source} />);

    expect(screen.getByText(word)).toBeTruthy();
    expect(drawing().className).toContain(`lucide-${glyph}`);
    expect(drawing()).toMatchObject({ width: 16, height: 16 });
  });

  test('is filled with its tone’s mark, the glyph and word in onMark', async () => {
    await render(<SourceBadge testID="chip" source={source} />);

    const colors = Colors.light.tone[tone];
    expect(styleOf(screen.getByTestId('chip')).backgroundColor).toBe(colors.mark);
    expect(styleOf(screen.getByText(word)).color).toBe(colors.onMark);
    expect(drawing().stroke).toBe(colors.onMark);
  });

  test('dark theme: the dark tone’s mark and onMark', async () => {
    scheme.mockReturnValue('dark');

    await render(<SourceBadge testID="chip" source={source} />);

    const colors = Colors.dark.tone[tone];
    expect(styleOf(screen.getByTestId('chip')).backgroundColor).toBe(colors.mark);
    expect(styleOf(screen.getByText(word)).color).toBe(colors.onMark);
    expect(drawing().stroke).toBe(colors.onMark);
  });

  test('the reader hears the word, not the glyph', async () => {
    await render(<SourceBadge testID="chip" source={source} />);

    expect(
      isHiddenFromAccessibility(screen.getByTestId('chip-icon', { includeHiddenElements: true })),
    ).toBe(true);
    expect(isHiddenFromAccessibility(screen.getByText(word))).toBe(false);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

test('the two chips part by their fill, not only by their word', () => {
  for (const colors of [Colors.light.tone, Colors.dark.tone]) {
    expect(colors[SIGNAL_SOURCE_LOOK.review.tone].mark).not.toBe(
      colors[SIGNAL_SOURCE_LOOK.message.tone].mark,
    );
  }
});

test.each([
  ['en', 'From a review', 'From a chat'],
  ['cs', 'Z recenze', 'Z chatu'],
])('in %s the chips say «%s» and «%s»', async (language, review, chat) => {
  await i18n.changeLanguage(language);

  await render(
    <>
      <SourceBadge source="review" />
      <SourceBadge source="message" />
    </>,
  );

  expect(screen.getByText(review)).toBeTruthy();
  expect(screen.getByText(chat)).toBeTruthy();
});
