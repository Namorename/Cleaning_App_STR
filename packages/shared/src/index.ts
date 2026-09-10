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
export {
  FALLBACK_LANGUAGE,
  INTL_LOCALES,
  SUPPORTED_LANGUAGES,
  isSupportedLanguage,
  resolveLanguage,
  translationResources,
  translations,
  type Language,
} from './i18n';

import type { Tables, Enums } from './database.types';

export type Host = Tables<'hosts'>;
export type Task = Tables<'tasks'>;
export type Property = Tables<'properties'>;
export type Profile = Tables<'profiles'>;
export type PropertyCleaner = Tables<'property_cleaners'>;
export type WorkflowTemplate = Tables<'workflow_templates'>;
export type WorkflowStep = Tables<'workflow_steps'>;
export type TaskStep = Tables<'task_steps'>;
export type ChecklistModule = Tables<'checklist_modules'>;
export type ChecklistItem = Tables<'checklist_items'>;
export type TaskMedia = Tables<'task_media'>;
export type Problem = Tables<'problems'>;
export type SupplyRequest = Tables<'supply_requests'>;
export type SupplyRequestItem = Tables<'supply_request_items'>;
export type SupplyCatalogItem = Tables<'supply_catalog_items'>;

export type TaskStatus = Enums<'task_status'>;
export type TaskType = Enums<'task_type'>;
export type AssignmentMode = Enums<'assignment_mode'>;
export type AppRole = Enums<'app_role'>;
export type AppLanguage = Enums<'app_language'>;
export type WorkflowScope = Enums<'workflow_scope'>;
export type WorkflowStepType = Enums<'workflow_step_type'>;
export type MediaKind = Enums<'media_kind'>;
export type ProblemPriority = Enums<'problem_priority'>;
export type ProblemStatus = Enums<'problem_status'>;
export type SupplyRequestStatus = Enums<'supply_request_status'>;
export type SupplyPriority = Enums<'supply_priority'>;
export type SupplyUnit = Enums<'supply_unit'>;
