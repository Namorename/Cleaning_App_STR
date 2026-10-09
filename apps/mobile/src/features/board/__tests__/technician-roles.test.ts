import { isTechnician } from '@/features/auth/role';
import { i18n } from '@/i18n';
import { HEAD_TECH, STAFF, TECH_IVAN } from '@/testing/board-fixtures';

import { staffNames } from '../format';
import { activeTechnicians, type StaffMember } from '../schema';

/**
 * Who is a technician is said once, by the role module (`features/auth/role.ts`,
 * item 9 of the two whole-branch reviews of phone-1-2-0): the board's people —
 * whom «Назначить» offers, who is numbered when nameless — follow it, so a
 * role added there is a technician here too. The role module is wrapped to
 * tell technicians apart its own way, and the board is asked again.
 */

jest.mock('@/features/auth/role', () => {
  const actual = jest.requireActual('@/features/auth/role');
  return { ...actual, isTechnician: jest.fn(actual.isTechnician) };
});

beforeEach(() => {
  // Only the head technician is a technician, as far as the role module says.
  jest.mocked(isTechnician).mockImplementation((role) => role === 'head_tech');
});

test('«Назначить» offers whom the role module calls a technician', () => {
  expect(activeTechnicians(STAFF).map((person) => person.id)).toEqual([HEAD_TECH]);
});

test('a nameless person is numbered as a technician only when the role module says he is one', () => {
  const nameless: StaffMember[] = [
    { id: TECH_IVAN, full_name: null, role: 'tech', is_active: true },
    { id: HEAD_TECH, full_name: null, role: 'head_tech', is_active: true },
  ];

  const names = staffNames(nameless, i18n.t);

  expect(names.get(HEAD_TECH)).toBe('Техник 1');
  expect(names.has(TECH_IVAN)).toBe(false);
});
