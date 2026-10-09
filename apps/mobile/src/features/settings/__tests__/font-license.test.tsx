import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Platform } from 'react-native';

import { Spacing } from '@/constants/theme';
import { BOTTOM_INSETS, scrollEndPadding, withBottomInset } from '@/testing/insets';

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

// Block 3 (2026-10-10): Android's three-button navigation bar lay over the
// bottom of the screens. The licence's last lines, scrolled to the end, stop
// clear of the system's bar; on iOS UIKit insets this scroll view itself.
describe.each(BOTTOM_INSETS)('with a bottom inset of %i dp', (bottom) => {
  let os: { restore: () => void } | undefined;

  afterEach(() => {
    os?.restore();
    os = undefined;
  });

  test('on Android the end of the licence scrolls clear of the system’s bar', async () => {
    os = jest.replaceProperty(Platform, 'OS', 'android');
    await render(withBottomInset(bottom, <FontLicenseScreen />));

    expect(scrollEndPadding()).toBe(Spacing.lg + bottom);
  });

  test('on iOS the system insets it, and the screen adds nothing', async () => {
    os = jest.replaceProperty(Platform, 'OS', 'ios');
    await render(withBottomInset(bottom, <FontLicenseScreen />));

    expect(scrollEndPadding()).toBe(Spacing.lg);
  });
});
