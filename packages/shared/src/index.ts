// Общие типы и константы. Типы БД генерируются: npm run db:types

export type {
  Database,
  Json,
  Tables,
  TablesInsert,
  TablesUpdate,
  Enums,
  CompositeTypes,
} from './database.types';
export { Constants } from './database.types';

import type { Tables, Enums } from './database.types';

export type Host = Tables<'hosts'>;
export type Task = Tables<'tasks'>;
export type Property = Tables<'properties'>;
export type Profile = Tables<'profiles'>;
export type PropertyCleaner = Tables<'property_cleaners'>;

export type TaskStatus = Enums<'task_status'>;
export type TaskType = Enums<'task_type'>;
export type AssignmentMode = Enums<'assignment_mode'>;
export type AppRole = Enums<'app_role'>;
export type AppLanguage = Enums<'app_language'>;
