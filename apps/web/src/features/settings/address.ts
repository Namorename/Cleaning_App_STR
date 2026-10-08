import { z } from 'zod';

/** The sections of «Настройки», in the order the submenu lists them. */
export const SETTINGS_SECTIONS = ['account', 'appearance', 'company', 'process'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/**
 * What «Настройки» keep in their address (5.4, variant A): the section open
 * beside the submenu. A link, a bookmark, the sign-in page and «Назад» open
 * the page on the section that was left.
 */
export interface SettingsAddress {
  section: SettingsSection;
}

export const DEFAULT_SETTINGS_ADDRESS: SettingsAddress = { section: 'account' };

/** The name in the query: a manager may read and forward the link. */
const PARAM = { section: 'section' } as const;

const sectionSchema = z.enum(SETTINGS_SECTIONS);

/** The address as the page's state; a section it does not know is the bare page. */
export function readSettingsAddress(params: URLSearchParams): SettingsAddress {
  const parsed = sectionSchema.safeParse(params.get(PARAM.section));
  return { section: parsed.success ? parsed.data : DEFAULT_SETTINGS_ADDRESS.section };
}

/** The query for the state, without its `?`: empty for the first section. */
export function writeSettingsAddress({ section }: SettingsAddress): string {
  return section === DEFAULT_SETTINGS_ADDRESS.section
    ? ''
    : new URLSearchParams([[PARAM.section, section]]).toString();
}
