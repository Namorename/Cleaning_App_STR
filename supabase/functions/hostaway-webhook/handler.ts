/**
 * Приём вебхука Hostaway.
 *
 * КОДЫ ОТВЕТА — самое важное здесь. По документации Hostaway:
 *   - любой ответ 2xx означает «принято»;
 *   - сетевая ошибка, 5xx и 429 считаются временным сбоем: доставка
 *     повторяется до трёх раз в течение примерно часа;
 *   - остальные 4xx (400, 401, 403, 404) считаются ПОСТОЯННЫМ отказом,
 *     повтора не будет — событие пропадает навсегда;
 *   - пять суток подряд неудач, и Hostaway отключит вебхук.
 *
 * Отсюда правило: всё, в чём виноваты мы, отвечает 5xx, чтобы Hostaway
 * переспросил; 4xx остаётся только для случаев, когда запрос действительно
 * не должен приниматься.
 *
 *   не прочитались секреты      -> 500  наша ошибка развёртывания, повторяемо
 *   ошибка записи в журнал      -> 500  транзиентный сбой базы, повторяемо
 *   нет/битый/неверный пароль   -> 401  подделку принимать нельзя
 *   тело не разобралось         -> 200  повтор не поможет, сохраняем как есть
 *   неизвестное событие         -> 200  прямая рекомендация документации
 *
 * Проверка конфигурации идёт ДО проверки заголовка: иначе развёртывание
 * с забытым секретом маскировалось бы под неавторизованный запрос и
 * тихо выбрасывало брони.
 */

import { type BasicCredentials, verifyBasicAuth } from "../_shared/basic-auth.ts";
import { ConfigError } from "../_shared/env.ts";

export interface WebhookDeps {
  /** Может бросить ConfigError, если секреты не заданы. */
  readonly loadCredentials: () => BasicCredentials;
  /** Пишет уведомление в журнал и возвращает его номер. */
  readonly recordEvent: (payload: unknown) => Promise<number>;
}

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

function json(body: unknown, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Разбор тела.
 *
 * Нечитаемое тело не отбрасывается: оно заворачивается в объект и всё равно
 * попадает в журнал. Потерять уведомление хуже, чем сохранить его в сыром виде.
 */
async function readPayload(request: Request): Promise<unknown> {
  const text = await request.text();

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {
      unparsed: text,
      contentType: request.headers.get("Content-Type"),
    };
  }
}

export function createWebhookHandler(deps: WebhookDeps): (request: Request) => Promise<Response> {
  return async function handleWebhook(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return json({ error: "Ожидается POST" }, 405);
    }

    // 1. Конфигурация. Проверяется первой: её отсутствие — наша вина,
    //    и ответ обязан быть повторяемым.
    let credentials: BasicCredentials;
    try {
      credentials = deps.loadCredentials();
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      console.error(`Вебхук не настроен, отвечаем 500 ради повтора доставки: ${message}`);
      return json(
        { error: error instanceof ConfigError ? "Функция не настроена" : "Внутренняя ошибка" },
        500,
      );
    }

    // 2. Авторизация. Единственная защита: подписи Hostaway не присылает.
    const auth = await verifyBasicAuth(request.headers.get("Authorization"), credentials);
    if (!auth.ok) {
      // Причина пишется в журнал, потому что 401 повторяться не будет:
      // если это была настоящая доставка, бронь потеряна, и разбираться
      // придётся по этой записи и по суточной сверке.
      console.error(
        `Вебхук отклонён (${auth.reason}). Повтора со стороны Hostaway не будет. ` +
          (auth.reason === "missing"
            ? "Похоже, вебхук зарегистрирован без логина и пароля."
            : "Проверьте, совпадают ли учётные данные с указанными при регистрации."),
      );

      return json({ error: "Неверные учётные данные" }, 401, {
        "WWW-Authenticate": 'Basic realm="hostaway-webhook"',
      });
    }

    // 3. Тело. Читается уже после авторизации — неавторизованный запрос
    //    не должен попадать в журнал.
    const payload = await readPayload(request);

    // 4. Запись. Сбой здесь транзиентный, поэтому 500: Hostaway переспросит.
    try {
      const eventId = await deps.recordEvent(payload);
      return json({ accepted: true, eventId }, 200);
    } catch (error: unknown) {
      console.error(
        `Не удалось записать уведомление, отвечаем 500 ради повтора: ${getErrorMessage(error)}`,
      );
      return json({ error: "Не удалось принять уведомление" }, 500);
    }
  };
}
