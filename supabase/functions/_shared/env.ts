/**
 * Чтение и проверка окружения при старте функции.
 *
 * Падать нужно сразу и с полным списком недостающего: иначе развёртывание
 * превращается в череду прогонов, каждый из которых сообщает об одной
 * следующей забытой переменной.
 */

import type { BasicCredentials } from "./basic-auth.ts";
import type { HostawayCredentials } from "./hostaway.ts";

export interface SyncConfig {
  readonly supabaseUrl: string;
  readonly supabaseSecretKey: string;
  readonly hostaway: HostawayCredentials;
}

export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

/** Только чтение — ровно то, что нужно, и легко подменить в тестах. */
export interface EnvReader {
  get(key: string): string | undefined;
}

function readNonEmpty(env: EnvReader, key: string): string | null {
  const value = env.get(key);
  if (value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function readConfig(env: EnvReader): SyncConfig {
  const supabaseUrl = readNonEmpty(env, "SUPABASE_URL");

  // Новые ключи Supabase называются SECRET_KEY, в рантайме Edge Functions
  // историческое имя SERVICE_ROLE_KEY тоже встречается — принимаем оба.
  const supabaseSecretKey = readNonEmpty(env, "SUPABASE_SECRET_KEY") ??
    readNonEmpty(env, "SUPABASE_SERVICE_ROLE_KEY");

  const accountId = readNonEmpty(env, "HOSTAWAY_ACCOUNT_ID");
  const apiKey = readNonEmpty(env, "HOSTAWAY_API_KEY");

  const missing: string[] = [];
  if (supabaseUrl === null) missing.push("SUPABASE_URL");
  if (supabaseSecretKey === null) {
    missing.push("SUPABASE_SECRET_KEY (или SUPABASE_SERVICE_ROLE_KEY)");
  }
  if (accountId === null) missing.push("HOSTAWAY_ACCOUNT_ID");
  if (apiKey === null) missing.push("HOSTAWAY_API_KEY");

  if (missing.length > 0) {
    throw new ConfigError(`Missing environment variables: ${missing.join(", ")}`);
  }

  return {
    supabaseUrl: supabaseUrl as string,
    supabaseSecretKey: supabaseSecretKey as string,
    hostaway: {
      accountId: accountId as string,
      apiKey: apiKey as string,
    },
  };
}

/**
 * Учётные данные вебхука Hostaway.
 *
 * Читаются отдельно от остальной конфигурации: приёмник вебхука не ходит
 * ни в Hostaway API, ни за токеном, ему нужна только эта пара. Бросает
 * ConfigError, если хотя бы одна переменная не задана — обработчик по этому
 * отвечает 500, чтобы Hostaway повторил доставку.
 */
export function readWebhookCredentials(env: EnvReader): BasicCredentials {
  const login = readNonEmpty(env, "HOSTAWAY_WEBHOOK_LOGIN");
  const password = readNonEmpty(env, "HOSTAWAY_WEBHOOK_PASSWORD");

  const missing: string[] = [];
  if (login === null) missing.push("HOSTAWAY_WEBHOOK_LOGIN");
  if (password === null) missing.push("HOSTAWAY_WEBHOOK_PASSWORD");

  if (missing.length > 0) {
    throw new ConfigError(`Missing environment variables: ${missing.join(", ")}`);
  }

  return { login: login as string, password: password as string };
}
