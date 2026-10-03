import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { AboutSection } from '../about-section';
import { FontLicenseScreen } from '../font-license-screen';

/**
 * The font's licence is reachable from the settings and shown on a screen of
 * its own (OFL FAQ 1.20): a line in her language saying what it is, then the
 * licence itself, in English.
 */

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

test('«О приложении» leads to the font licence', async () => {
  await render(<AboutSection />);

  expect(screen.getByRole('header', { name: 'О приложении' })).toBeTruthy();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Лицензия шрифта, Nunito · SIL Open Font License 1.1' }),
  );

  expect(router.push).toHaveBeenCalledWith('/font-license');
});

test('the licence screen: what it is in her language, then the licence as written', async () => {
  await render(<FontLicenseScreen />);

  expect(
    screen.getByText(
      'Шрифт приложения — Nunito. Он распространяется по лицензии SIL Open Font License 1.1. Её текст ниже — на английском, как его публикуют авторы шрифта.',
    ),
  ).toBeTruthy();
  expect(
    screen.getByText(
      'Copyright 2014 The Nunito Project Authors (https://github.com/googlefonts/nunito)',
    ),
  ).toBeTruthy();
  expect(screen.getByRole('header', { name: 'PREAMBLE' })).toBeTruthy();
  expect(screen.getByRole('header', { name: 'DISCLAIMER' })).toBeTruthy();
});
