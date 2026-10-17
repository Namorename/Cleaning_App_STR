import { TONE_COLORS } from '@str-ops/shared';
import { fireEvent, getDefaultNormalizer, render, screen } from '@testing-library/react-native';
import { Linking, StyleSheet } from 'react-native';

import { KbBody } from '../kb-body';

jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: jest.fn(() => 'light') }));

let openURL: jest.SpyInstance;

beforeEach(() => {
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
});

afterEach(() => {
  openURL.mockRestore();
});

test('a paragraph keeps the line breaks its author typed, and bold stays in the line', async () => {
  await render(<KbBody body={'Котёл в коридоре.\nКнопка **справа**.'} />);

  expect(
    screen.getByText('Котёл в коридоре.\nКнопка справа.', {
      normalizer: getDefaultNormalizer({ collapseWhitespace: false }),
    }),
  ).toBeOnTheScreen();
  expect(screen.getByText('справа')).toBeOnTheScreen();
});

test('lists, numbers and steps are drawn as such', async () => {
  await render(
    <KbBody body={'- полотенца\n- мыло\n\n3. первое\n4. второе\n\n1) Открой кран.\n2) Закрой.'} />,
  );

  expect(screen.getByText('полотенца')).toBeOnTheScreen();
  // A bullet is drawn, not read: the screen reader stops on the item alone.
  expect(screen.getAllByText('•', { includeHiddenElements: true })).toHaveLength(2);
  expect(screen.queryAllByText('•')).toHaveLength(0);
  expect(screen.getByText('3.')).toBeOnTheScreen();
  expect(screen.getByText('4.')).toBeOnTheScreen();
  expect(screen.getByText('Шаг 1')).toBeOnTheScreen();
  expect(screen.getByText('Шаг 2')).toBeOnTheScreen();
});

test('an important note stands out, under its own word', async () => {
  await render(<KbBody body={'> Не трогай котёл.'} />);

  expect(screen.getByText('Важно')).toBeOnTheScreen();
  const note = screen.getByTestId('kb-important');
  expect(StyleSheet.flatten(note.props.style)).toMatchObject({
    backgroundColor: TONE_COLORS.light.urgent.bg,
    borderLeftColor: TONE_COLORS.light.urgent.border,
  });
});

test('a link opens in the phone’s browser, and says where it goes', async () => {
  await render(<KbBody body={'Схема: [здесь](https://example.com/map).'} />);

  const link = screen.getByRole('link', { name: 'здесь' });
  expect(screen.getByText('(example.com)')).toBeOnTheScreen();
  await fireEvent.press(link);

  expect(openURL).toHaveBeenCalledWith('https://example.com/map');
});

test('an address that is not https stays text, and nothing opens it', async () => {
  await render(<KbBody body={'[click](http://example.com) javascript:alert(1)'} />);

  expect(screen.queryByRole('link')).toBeNull();
  expect(openURL).not.toHaveBeenCalled();
});

test('HTML is shown as the text it is, never run', async () => {
  await render(<KbBody body={'<script>alert(1)</script> <b>bold</b>'} />);

  expect(screen.getByText('<script>alert(1)</script> <b>bold</b>')).toBeOnTheScreen();
});
