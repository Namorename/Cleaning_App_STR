import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

// The company's switches and the process read the database; their own tests
// cover them. Here they are placeholders, so the page renders on its own.
vi.mock('../host-toggles', () => ({ HostToggles: () => null }));
vi.mock('@/features/workflow/process-section', () => ({ ProcessSection: () => null }));

import { expectPageTitle } from '@/components/page-header.expect';

import { SettingsView } from '../settings-view';

describe('SettingsView', () => {
  test('is headed by the common header, the account under it', () => {
    render(
      <SettingsView email="manager.test@example.com" theme="system" onSignOut={vi.fn()} />,
    );

    expectPageTitle('Настройки');
    expect(screen.getByText('Аккаунт')).toBeInTheDocument();
  });
});
