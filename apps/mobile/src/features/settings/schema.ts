import { Constants, type AppRole, type Enums } from '@str-ops/shared';
import { z } from 'zod';

import { knownRole } from '@/features/auth/role';

export type PushKind = Enums<'push_kind'>;

/**
 * Every event that sends a push, in the order of the database enum — which is
 * the order the owner approved them in and the order the screen lists them.
 * Read off the generated types, so a kind added by a migration appears here
 * with the next `db:types` and a renamed one is a type error, not a switch
 * that silently matches nothing.
 */
export const PUSH_KINDS: readonly PushKind[] = Constants.public.Enums.push_kind;

/**
 * The kinds sent to some roles only, each with the roles it is for; a kind
 * not named here is offered to everybody. A new task (problem_new) goes to
 * the head technician alone (20261003160000_head_tech_push), so nobody else
 * is shown its switch — not a switch greyed out, no row at all (owner's word
 * 2026-10-03, docs/tech-plan.md, decision 19).
 */
const KIND_ROLES: Partial<Record<PushKind, readonly AppRole[]>> = {
  problem_new: ['head_tech'],
};

/**
 * The kinds a role never receives. A technician and a head technician have
 * nothing to do with cleanings (tech-plan §2): a new or a free cleaning, or a
 * booking cancelled while one is under way, is never theirs — seven kinds
 * for the technician, not ten (§5); the head technician has «Новое задание»
 * on top. Assigned, taken off, cancelled, moved, new hours: their repairs.
 */
const NOT_FOR: Partial<Record<AppRole, readonly PushKind[]>> = {
  tech: ['cleaning_new', 'cleaning_free', 'booking_cancelled_live'],
  head_tech: ['cleaning_new', 'cleaning_free', 'booking_cancelled_live'],
};

/**
 * The kinds whose switch a person with this role is shown, in the enum's
 * order. A token without a role, or with one this build does not know, is
 * shown only the kinds that go to everybody — the cleaner's.
 */
export function kindsFor(role: string | null): readonly PushKind[] {
  const known = knownRole(role);
  const never: readonly PushKind[] = known === null ? [] : (NOT_FOR[known] ?? []);
  return PUSH_KINDS.filter((kind) => {
    const roles: readonly string[] | undefined = KIND_ROLES[kind];
    const isOffered = roles === undefined || (known !== null && roles.includes(known));
    return isOffered && !never.includes(kind);
  });
}

function isPushKind(value: unknown): value is PushKind {
  return typeof value === 'string' && (PUSH_KINDS as readonly string[]).includes(value);
}

/** The muted kinds in the enum's order, each once: the shape the server keeps. */
function inKindOrder(kinds: readonly PushKind[]): PushKind[] {
  return PUSH_KINDS.filter((kind) => kinds.includes(kind));
}

/**
 * Her row of `push_preferences`: the kinds she switched OFF.
 *
 * A kind a newer server knows and this build does not is dropped rather than
 * failing the parse — the row would otherwise take the whole screen with it
 * on the day a kind is added. `.default([])` reads a row saved to disk in a
 * shape without the list as "nothing muted".
 */
export const pushPreferencesSchema = z.object({
  profile_id: z.string(),
  muted: z
    .array(z.unknown())
    .default([])
    .transform((kinds) => inKindOrder(kinds.filter(isPushKind))),
});

export type PushPreferences = z.infer<typeof pushPreferencesSchema>;

/** What the query holds: her row, or null when she never switched anything off. */
export const cachedPushPreferencesSchema = pushPreferencesSchema.nullable();

/**
 * What the cache holds, read leniently: it came from disk and may be any
 * shape. What cannot be read counts as no row — everything on — which is the
 * state a person starts from anyway.
 */
export function pushPreferencesFrom(cached: unknown): PushPreferences | null {
  const parsed = cachedPushPreferencesSchema.safeParse(cached);
  return parsed.success ? parsed.data : null;
}

/** No row means everything is on: a kind is off only when it is on her list. */
export function isPushEnabled(
  preferences: PushPreferences | null | undefined,
  kind: PushKind,
): boolean {
  return !(preferences?.muted.includes(kind) ?? false);
}

/**
 * Her row once one kind is set to the value she wants.
 *
 * Takes whatever the cache held (`pushPreferencesFrom`). Setting a value,
 * never flipping one, is what makes a replay land where the first attempt did.
 */
export function withPushChoice(
  cached: unknown,
  userId: string,
  kind: PushKind,
  enabled: boolean,
): PushPreferences {
  const muted = pushPreferencesFrom(cached)?.muted ?? [];
  const others = muted.filter((existing) => existing !== kind);
  return { profile_id: userId, muted: inKindOrder(enabled ? others : [...others, kind]) };
}
