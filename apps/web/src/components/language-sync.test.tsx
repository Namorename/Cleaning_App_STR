import { render } from '@testing-library/react';
import { useTranslation } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { i18n } from '@/lib/i18n';

import { LanguageSync } from './language-sync';

/** A label the test can read, in whatever language the dictionary speaks now. */
function Label() {
  const { t } = useTranslation();
  return <span>{t('panel.settings.language.label')}</span>;
}

beforeEach(() => {
  document.documentElement.lang = 'ru';
});

afterEach(async () => {
  // One dictionary for the whole run: the next file reads Russian.
  await i18n.changeLanguage('ru');
  document.documentElement.lang = '';
});

/**
 * The dictionary is made once per browser tab, from the cookie the first page
 * was rendered with; a page entered without a reload keeps it. The sign-in is
 * such an entry: it sets the cookie from the profile and moves on to the panel
 * — whose shell renders afresh on the server, with the new cookie — so the
 * shell hands the dictionary the language the server rendered in.
 */
describe('LanguageSync', () => {
  test('a shell rendered in another language switches the open page to it', () => {
    const { container } = render(
      <>
        <LanguageSync language="cs" />
        <Label />
      </>,
    );

    expect(container).toHaveTextContent('Jazyk');
    expect(i18n.language).toBe('cs');
    expect(document.documentElement.lang).toBe('cs');
  });

  test('the language the page already speaks is left alone', () => {
    const { container } = render(
      <>
        <LanguageSync language="ru" />
        <Label />
      </>,
    );

    expect(container).toHaveTextContent('Язык');
    expect(i18n.language).toBe('ru');
  });

  test('a later render in a new language — a refresh after a choice — follows it', () => {
    const { container, rerender } = render(
      <>
        <LanguageSync language="ru" />
        <Label />
      </>,
    );

    rerender(
      <>
        <LanguageSync language="en" />
        <Label />
      </>,
    );

    expect(container).toHaveTextContent('Language');
    expect(document.documentElement.lang).toBe('en');
  });
});
