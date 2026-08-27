/**
 * Точка входа приёмника вебхуков Hostaway.
 *
 * Вся логика и разбор кодов ответа — в handler.ts, здесь только сборка
 * зависимостей. Так обработчик остаётся проверяемым без поднятия HTTP.
 *
 * Функция развёртывается с verify_jwt = false: Hostaway не умеет присылать
 * токен Supabase, защита обеспечивается Basic Auth (см. handler.ts).
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { readConfig, readWebhookCredentials } from "../_shared/env.ts";
import { createWebhookHandler } from "./handler.ts";

/**
 * Клиент создаётся один раз на холодный старт, а не на каждый запрос:
 * Hostaway ждёт подтверждения 20 секунд, лишние миллисекунды не нужны.
 *
 * Если конфигурация Supabase не прочиталась, оставляем null — обработчик
 * получит ошибку при записи и ответит 500, то есть доставка повторится.
 */
const supabase = (() => {
  try {
    const config = readConfig(Deno.env);
    return createClient(config.supabaseUrl, config.supabaseSecretKey, {
      auth: { persistSession: false },
    });
  } catch (error: unknown) {
    console.error(
      `Клиент Supabase не создан: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
})();

const handleWebhook = createWebhookHandler({
  loadCredentials: () => readWebhookCredentials(Deno.env),

  recordEvent: async (payload: unknown): Promise<number> => {
    if (supabase === null) {
      throw new Error("Клиент Supabase недоступен: проверьте переменные окружения");
    }

    const { data, error } = await supabase.rpc("record_webhook_event", {
      event_payload: payload,
    });

    if (error) {
      throw new Error(`RPC record_webhook_event: ${error.message}`);
    }

    return Number(data);
  },
});

Deno.serve(handleWebhook);
