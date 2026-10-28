/**
 * The scope registry's data for the panel (registry.json, typed). Kept apart
 * from registry.ts so that the rules there load in Node without a JSON import.
 */

import registryJson from './registry.json';
import type { ApiRegistry } from './registry';

export const API_REGISTRY = registryJson as ApiRegistry;
