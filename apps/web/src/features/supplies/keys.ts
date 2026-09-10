/** Query keys for the supplies section. */
export const supplyKeys = {
  all: ['supplies'] as const,
  list: () => ['supplies', 'list'] as const,
  catalog: () => ['supplies', 'catalog'] as const,
  companyLanguage: () => ['supplies', 'company-language'] as const,
};
