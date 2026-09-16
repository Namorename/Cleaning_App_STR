export const propertyKeys = {
  all: ['properties'] as const,
  reportable: () => ['properties', 'reportable'] as const,
};
