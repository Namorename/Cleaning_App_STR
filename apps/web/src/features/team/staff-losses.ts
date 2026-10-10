import type { Staff, StaffDraft, StaffRole } from './schema';

/** One thing an edit of a person takes away for good. */
export type StaffLoss =
  | { kind: 'disable' }
  | { kind: 'role'; from: StaffRole; to: StaffRole }
  | { kind: 'unlink'; total: number };

/**
 * What saving this edit would take away that the panel cannot give back, said
 * before the save (the owner, 10.10): the account switched off — its listings
 * and the work nobody started go with it (20261004100000) — a new role, and
 * listings unticked on the form.
 *
 * Switching somebody back on, a new phone or name, a listing added: nothing is
 * lost, nothing is asked. A role the panel did not know, chosen now, is a
 * first choice rather than a change.
 */
export function lossesOf(staff: Staff, draft: StaffDraft, unlinked: number): StaffLoss[] {
  const from = staff.role;
  const to = draft.role;
  const disable: StaffLoss[] = staff.is_active && !draft.isActive ? [{ kind: 'disable' }] : [];
  const role: StaffLoss[] =
    from !== null && to !== '' && to !== from ? [{ kind: 'role', from, to }] : [];
  const unlink: StaffLoss[] = unlinked > 0 ? [{ kind: 'unlink', total: unlinked }] : [];
  return [...disable, ...role, ...unlink];
}
