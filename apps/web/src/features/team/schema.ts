import { z } from 'zod';

export const STAFF_ROLES = ['cleaner', 'tech', 'manager', 'admin'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const LANGUAGES = ['ru', 'en', 'cs'] as const;
export type Language = (typeof LANGUAGES)[number];

export const ASSIGNMENT_MODES = ['auto', 'claim'] as const;
export type AssignmentMode = (typeof ASSIGNMENT_MODES)[number];

/**
 * Who can be put on a listing.
 *
 * The link says who does the work there, so it is offered to the people who
 * do work: a manager is not a queue member, and putting her in one would make
 * her turn up in the phone's schedule.
 */
export const LINKABLE_ROLES: readonly StaffRole[] = ['cleaner', 'tech'];

/** 1 is the listing's main cleaner; the ceiling matches `save_property_cleaner`. */
export const MIN_PRIORITY = 1;
export const MAX_PRIORITY = 99;

/**
 * A person on the team.
 *
 * `role` and `preferred_language` fall back rather than throw: a value the
 * panel does not know yet — a role added by a later migration — must not blank
 * the whole list.
 */
export const staffSchema = z.object({
  id: z.uuid(),
  full_name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  role: z.enum(STAFF_ROLES).catch('cleaner'),
  preferred_language: z.enum(LANGUAGES).nullable().catch(null),
  is_active: z.boolean(),
  created_at: z.string(),
});
export type Staff = z.infer<typeof staffSchema>;
export const staffListSchema = z.array(staffSchema);

export const propertySchema = z.object({ id: z.number(), name: z.string() });
export type Property = z.infer<typeof propertySchema>;
export const propertyListSchema = z.array(propertySchema);

export const cleanerLinkSchema = z.object({
  property_id: z.number(),
  cleaner_id: z.uuid(),
  mode: z.enum(ASSIGNMENT_MODES),
  priority: z.number(),
});
export type CleanerLink = z.infer<typeof cleanerLinkSchema>;
export const cleanerLinkListSchema = z.array(cleanerLinkSchema);

/**
 * What the Edge Function answers with.
 *
 * A password comes back from creating an account and from resetting one, and
 * not from an edit — an edit does not touch it.
 */
export const staffAccountSchema = z.object({
  id: z.string(),
  password: z.string().optional(),
  emailSent: z.boolean().optional(),
  mailFailureKey: z.string().nullable().optional(),
});
export type StaffAccount = z.infer<typeof staffAccountSchema>;

// ---------------------------------------------------------------------------
//  The form
// ---------------------------------------------------------------------------

export interface StaffDraft {
  /** Null while the person is being invented. */
  id: string | null;
  fullName: string;
  email: string;
  phone: string;
  role: StaffRole;
  /** Empty means nothing has been chosen — not "English". */
  language: Language | '';
  isActive: boolean;
}

export const EMPTY_DRAFT: StaffDraft = {
  id: null,
  fullName: '',
  email: '',
  phone: '',
  role: 'cleaner',
  language: '',
  isActive: true,
};

export function draftFrom(staff: Staff | null): StaffDraft {
  if (staff === null) {
    return EMPTY_DRAFT;
  }
  return {
    id: staff.id,
    fullName: staff.full_name ?? '',
    email: staff.email ?? '',
    phone: staff.phone ?? '',
    role: staff.role,
    language: staff.preferred_language ?? '',
    isActive: staff.is_active,
  };
}

// ---------------------------------------------------------------------------
//  Narrowing the list
// ---------------------------------------------------------------------------

/** Who is working, who is not, and everybody — the same three shapes the other sections use. */
export const TEAM_TABS = ['working', 'off', 'all'] as const;
export type TeamTab = (typeof TEAM_TABS)[number];

export function isInTab(staff: Staff, tab: TeamTab): boolean {
  if (tab === 'all') {
    return true;
  }
  return tab === 'working' ? staff.is_active : !staff.is_active;
}

/**
 * A search looks at the name, the login and the phone number.
 *
 * The manager has one of the three in front of her — a message, a note, a
 * missed call — and should not have to know which one the panel indexes.
 */
export function matchesSearch(staff: Staff, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return true;
  }
  return [staff.full_name, staff.email, staff.phone].some((field) =>
    (field ?? '').toLowerCase().includes(needle),
  );
}

export function matchesRole(staff: Staff, role: StaffRole | ''): boolean {
  return role === '' || staff.role === role;
}

export function canHaveLinks(staff: Staff): boolean {
  return LINKABLE_ROLES.includes(staff.role);
}

// ---------------------------------------------------------------------------
//  Listings a person works
// ---------------------------------------------------------------------------

export interface LinkRow {
  propertyId: number;
  name: string;
  mode: AssignmentMode;
  priority: number;
}

export function countLinks(links: CleanerLink[], cleanerId: string): number {
  return links.filter((link) => link.cleaner_id === cleanerId).length;
}

/**
 * This person's listings, in the order they matter.
 *
 * The ones handed to her automatically come first — those are hers whether she
 * looks or not — then the shared ones by position, and names break the tie so
 * the list does not shuffle between renders.
 */
export function linksOf(links: CleanerLink[], properties: Property[], cleanerId: string): LinkRow[] {
  const names = new Map(properties.map((property) => [property.id, property.name]));

  return links
    .filter((link) => link.cleaner_id === cleanerId)
    .map((link) => ({
      propertyId: link.property_id,
      name: names.get(link.property_id) ?? String(link.property_id),
      mode: link.mode,
      priority: link.priority,
    }))
    .sort((left, right) => {
      if (left.mode !== right.mode) {
        return left.mode === 'auto' ? -1 : 1;
      }
      return left.priority - right.priority || left.name.localeCompare(right.name);
    });
}

/** What is left to offer — a listing she already works is not an option. */
export function unlinkedProperties(
  links: CleanerLink[],
  properties: Property[],
  cleanerId: string,
): Property[] {
  const taken = new Set(
    links.filter((link) => link.cleaner_id === cleanerId).map((link) => link.property_id),
  );
  return properties.filter((property) => !taken.has(property.id));
}
