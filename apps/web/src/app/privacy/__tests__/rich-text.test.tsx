import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { renderRich } from '../rich-text';

/**
 * The policy's sentences live in the shared locales with two marks of their
 * own: `<b>…</b>` for the words the draft sets in bold, `{{name}}` for what
 * the page puts in — a value, a link, a placeholder. Nothing else is read as
 * markup, and nothing is ever set as HTML.
 */
describe('renderRich', () => {
  test('sets the marked words in bold and leaves the rest as text', () => {
    render(<p>{renderRich('<b>Effective from:</b> today')}</p>);

    expect(screen.getByText('Effective from:').tagName).toBe('STRONG');
    expect(screen.getByRole('paragraph')).toHaveTextContent('Effective from: today');
  });

  test('puts each named slot in its place, a node as well as a string', () => {
    render(
      <p>
        {renderRich('Write to {{email}}; format {{format}}.', {
          email: <a href="mailto:a@example.cz">a@example.cz</a>,
          format: 'JSON',
        })}
      </p>,
    );

    expect(screen.getByRole('paragraph')).toHaveTextContent('Write to a@example.cz; format JSON.');
    expect(screen.getByRole('link', { name: 'a@example.cz' })).toBeInTheDocument();
  });

  test('fills a slot inside the bold words too', () => {
    render(<p>{renderRich('<b>[{{what}}]</b>', { what: 'date' })}</p>);

    expect(screen.getByText('[date]').tagName).toBe('STRONG');
  });

  test('reads any other angle bracket as text', () => {
    render(<p>{renderRich('<script>alert(1)</script> & <i>x</i>')}</p>);

    expect(screen.getByRole('paragraph')).toHaveTextContent('<script>alert(1)</script> & <i>x</i>');
    expect(document.querySelector('script, i')).toBeNull();
  });

  test('refuses a slot it was not given, rather than print its name', () => {
    expect(() => renderRich('By {{date}}.', {})).toThrow('No value for {{date}}');
  });
});
