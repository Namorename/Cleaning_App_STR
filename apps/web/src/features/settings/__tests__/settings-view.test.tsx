import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// The company's switches and the process read the database; their own tests
// cover them. Here they are stand-ins: the process one keeps what is typed into
// it, as the real editor keeps a draft, so leaving the section can be seen.
vi.mock('../host-toggles', async () => {
  const { createElement } = await import('react');
  return { HostToggles: () => createElement('p', null, 'Переключатели компании') };
});
vi.mock('@/features/workflow/process-section', async () => {
  const { createElement } = await import('react');
  return {
    ProcessSection: () => createElement('input', { 'aria-label': 'Черновик процесса' }),
  };
});
vi.mock('../video-settings', async () => {
  const { createElement } = await import('react');
  return { VideoSettings: () => createElement('p', null, 'Пределы видео компании') };
});

// The router reads the address jsdom holds; the view writes it through
// history, which jsdom keeps as a browser would. «Назад» moves it a task later
// with `popstate`, and the router shows the page again — as Next does.
vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  const subscribe = (onChange: () => void) => {
    window.addEventListener('popstate', onChange);
    return () => window.removeEventListener('popstate', onChange);
  };
  return {
    useSearchParams: () =>
      new URLSearchParams(useSyncExternalStore(subscribe, () => window.location.search)),
    usePathname: () => window.location.pathname,
  };
});

import { expectPageTitle } from '@/components/page-header.expect';

import { SettingsView } from '../settings-view';

const view = () => (
  <SettingsView email="manager.test@example.com" theme="system" onSignOut={vi.fn()} />
);

/** The query of the page's address, without its `?`. */
const query = () => window.location.search.slice(1);

/** «Назад»: jsdom walks the history a task later and says so with `popstate`. */
function goBack(): Promise<void> {
  return new Promise((resolve) => {
    window.addEventListener('popstate', () => resolve(), { once: true });
    window.history.back();
  });
}

const submenu = () => screen.getByRole('navigation', { name: 'Разделы настроек' });
const sectionLink = (name: string) => within(submenu()).getByRole('link', { name });
/** The section on screen: a region named by its h2. Hidden ones are not found. */
const section = (name: string) => screen.queryByRole('region', { name });

beforeEach(() => {
  window.history.replaceState(null, '', '/settings');
});

describe('the page', () => {
  test('is headed by the common header, the submenu lists its sections as links', () => {
    render(view());

    expectPageTitle('Настройки');
    const links = within(submenu()).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'Аккаунт',
      'Оформление',
      'Компания',
      'Процесс',
    ]);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/settings',
      '/settings?section=appearance',
      '/settings?section=company',
      '/settings?section=process',
    ]);
  });

  test('a bare address opens the account, and only the account', () => {
    render(view());

    expect(section('Аккаунт')).toHaveTextContent('Вы вошли как manager.test@example.com.');
    expect(within(section('Аккаунт') as HTMLElement).getByRole('button', { name: 'Выйти' }))
      .toBeInTheDocument();
    expect(sectionLink('Аккаунт')).toHaveAttribute('aria-current', 'page');
    expect(section('Оформление')).toBeNull();
    expect(section('Компания')).toBeNull();
    expect(section('Процесс')).toBeNull();
  });

  test('the address names the section: it is open and its link marked', () => {
    window.history.replaceState(null, '', '/settings?section=company');

    render(view());

    expect(section('Компания')).toHaveTextContent('Переключатели компании');
    expect(section('Компания')).toHaveTextContent(
      'Действует на все объекты и на всех сотрудников.',
    );
    expect(sectionLink('Компания')).toHaveAttribute('aria-current', 'page');
    expect(sectionLink('Аккаунт')).not.toHaveAttribute('aria-current');
    expect(section('Аккаунт')).toBeNull();
  });

  test('the look of this browser is a section of its own', () => {
    window.history.replaceState(null, '', '/settings?section=appearance');

    render(view());

    expect(within(section('Оформление') as HTMLElement).getByLabelText('Тема')).toBeInTheDocument();
  });

  // docs/tech-plan.md, 9: «Настройки → Процесс → Видео».
  test('the video of the company is set in the process, after its steps', () => {
    window.history.replaceState(null, '', '/settings?section=process');

    render(view());

    const process = section('Процесс') as HTMLElement;
    const steps = within(process).getByLabelText('Черновик процесса');
    const video = within(process).getByText('Пределы видео компании');
    expect(steps.compareDocumentPosition(video) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(section('Компания')).toBeNull();
  });

  test('a section the panel does not know opens the account', () => {
    window.history.replaceState(null, '', '/settings?section=billing');

    render(view());

    expect(section('Аккаунт')).not.toBeNull();
  });

  test('a press on a section opens it as a step, and «Назад» walks back', async () => {
    window.history.pushState(null, '', '/settings');
    render(view());

    await userEvent.click(sectionLink('Процесс'));

    expect(query()).toBe('section=process');
    expect(section('Процесс')).not.toBeNull();
    expect(section('Аккаунт')).toBeNull();

    await goBack();

    expect(query()).toBe('');
    expect(await screen.findByRole('region', { name: 'Аккаунт' })).toBeInTheDocument();
    expect(section('Процесс')).toBeNull();
  });

  // The review of 05.10: a second press on the open section is not a step —
  // «Назад» would otherwise walk through the same section twice.
  test('a press on the section already open adds no step', async () => {
    window.history.replaceState(null, '', '/settings?section=company');
    render(view());
    const steps = window.history.length;

    await userEvent.click(sectionLink('Компания'));

    expect(window.history.length).toBe(steps);
    expect(query()).toBe('section=company');
  });

  // The process editor holds a draft until it is saved. A press on another
  // section must not throw it away: every section stays mounted, only hidden.
  test('a section left keeps what was typed in it', async () => {
    window.history.replaceState(null, '', '/settings?section=process');
    render(view());

    await userEvent.type(screen.getByLabelText('Черновик процесса'), 'Уборка после выезда');
    await userEvent.click(sectionLink('Компания'));
    await userEvent.click(sectionLink('Процесс'));

    expect(screen.getByLabelText('Черновик процесса')).toHaveValue('Уборка после выезда');
  });
});

describe('the layout', () => {
  // Variant A: one width for every section, instead of three cards of three widths.
  test('every section is the same width', () => {
    const { container } = render(view());

    const sections = container.querySelectorAll('[data-slot="settings-section"]');
    expect(sections).toHaveLength(4);
    for (const one of sections) {
      expect(one).toHaveClass('max-w-3xl', 'w-full');
    }
  });

  test('the submenu links are 44 px targets', () => {
    render(view());

    for (const link of within(submenu()).getAllByRole('link')) {
      expect(link).toHaveClass('min-h-11');
    }
  });
});
