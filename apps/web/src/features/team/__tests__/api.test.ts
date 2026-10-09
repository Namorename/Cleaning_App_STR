import { describe, expect, test, vi } from 'vitest';

import { saveStaff } from '../api';
import type { StaffDraft } from '../schema';

const DRAFT: StaffDraft = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001',
  fullName: 'Zoe Unknown',
  email: 'zoe@example.com',
  phone: '',
  role: 'cleaner',
  language: '',
  isActive: true,
};

describe('saveStaff', () => {
  // docs/tech-plan.md, 3.5: a role the panel does not know is never saved as
  // a guess. The form refuses first; this is for a caller other than the form.
  test('refuses a person with no role the panel knows, and asks the server nothing', async () => {
    const invoke = vi.fn();
    const client = { functions: { invoke } } as never;

    await expect(saveStaff(client, { ...DRAFT, role: '' })).rejects.toThrow(
      'A person is saved only with a role the panel knows',
    );
    expect(invoke).not.toHaveBeenCalled();
  });
});
