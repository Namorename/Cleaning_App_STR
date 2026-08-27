/**
 * Клиент Hostaway API: OAuth, обновление протухшего токена, отступление при
 * перегрузке и постраничная выгрузка.
 *
 * Логика перенесена с рабочего Python-клиента из str-dwh
 * (src/extractors/hostaway_client.py), проверенного на этом же аккаунте.
 */

/** Документированный лимит Hostaway. */
export const RATE_LIMIT_REQUESTS = 15;
export const RATE_LIMIT_WINDOW_MS = 10_000;

/** Минимальный зазор между запросами, чтобы уложиться в лимит: 10000/15 ≈ 667 мс. */
export const MIN_REQUEST_INTERVAL_MS = Math.ceil(RATE_LIMIT_WINDOW_MS / RATE_LIMIT_REQUESTS);

export const RETRY_BASE_DELAY_MS = 2_000;
export const RETRY_MAX_DELAY_MS = 10_000;

/** Столько раз пробуем один и тот же запрос, прежде чем сдаться. */
export const MAX_ATTEMPTS = 5;

export const DEFAULT_PAGE_SIZE = 100;

const API_BASE_URL = "https://api.hostaway.com/v1";
const TOKEN_ENDPOINT = "accessTokens";

export interface HostawayCredentials {
  /** Account ID из Hostaway → Settings → Hostaway API. Он же OAuth client_id. */
  readonly accountId: string;
  /** API Key оттуда же. Он же OAuth client_secret. */
  readonly apiKey: string;
}

export interface HostawayClientOptions {
  /** Подменяется в тестах, чтобы не ходить в сеть. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  baseUrl?: string;
}

export class HostawayError extends Error {
  override readonly name = "HostawayError";
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Удвоение с потолком: 2с, 4с, 8с, дальше 10с. */
export function backoffDelay(attempt: number): number {
  const raw = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
  return Math.min(raw, RETRY_MAX_DELAY_MS);
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export class HostawayClient {
  readonly #credentials: HostawayCredentials;
  readonly #fetch: typeof fetch;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #now: () => number;
  readonly #baseUrl: string;

  #token: string | null = null;
  /** Момент последнего запроса ДАННЫХ; авторизация в темпе не участвует. */
  #lastRequestAt = 0;

  constructor(credentials: HostawayCredentials, options: HostawayClientOptions = {}) {
    this.#credentials = credentials;
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#sleep = options.sleep ?? defaultSleep;
    this.#now = options.now ?? Date.now;
    this.#baseUrl = options.baseUrl ?? API_BASE_URL;
  }

  /**
   * Выгружает эндпоинт целиком, склеивая страницы.
   *
   * Для listings Hostaway работает через offset, а не через курсор afterId —
   * это выяснено практикой, а не документацией.
   *
   * params попадают в каждую страницу: суточная сверка берёт не всю историю
   * (30 887 броней), а окно по дате выезда.
   */
  async listAll(
    endpoint: string,
    pageSize: number = DEFAULT_PAGE_SIZE,
    params: Readonly<Record<string, string>> = {},
  ): Promise<unknown[]> {
    const collected: unknown[] = [];
    let offset = 0;

    while (true) {
      const page = await this.#fetchPage(endpoint, pageSize, offset, params);
      if (page.length === 0) {
        break;
      }

      collected.push(...page);

      // Неполная страница — значит последняя, следующий запрос был бы холостым.
      if (page.length < pageSize) {
        break;
      }

      offset += pageSize;
    }

    return collected;
  }

  /**
   * Один объект по пути вида `reservations/65289672`.
   *
   * Разбор журнала вебхуков не доверяет телу уведомления и перезапрашивает
   * бронь сам: подписи у Hostaway нет, поэтому подделать уведомление проще,
   * чем подделать ответ API на наш собственный запрос.
   */
  async getObject(path: string): Promise<Record<string, unknown>> {
    const body = await this.#request(`${this.#baseUrl}/${path}`, path);
    const result = this.#unwrap(body, path);

    if (Array.isArray(result) || typeof result !== "object" || result === null) {
      throw new HostawayError(`Response for ${path} is not an object`);
    }

    return result as Record<string, unknown>;
  }

  /**
   * Пауза перед очередным запросом данных.
   *
   * Если сеть уже потратила больше интервала, спать не нужно — зазор набран
   * естественным образом.
   */
  async #pace(): Promise<void> {
    if (this.#lastRequestAt === 0) {
      return;
    }

    const elapsed = this.#now() - this.#lastRequestAt;
    if (elapsed < MIN_REQUEST_INTERVAL_MS) {
      await this.#sleep(MIN_REQUEST_INTERVAL_MS - elapsed);
    }
  }

  async #ensureToken(): Promise<string> {
    if (this.#token !== null) {
      return this.#token;
    }

    // Авторизация в темп не входит: на полную синхронизацию приходится
    // один-два таких запроса, зато последовательность отступлений остаётся
    // предсказуемой и проверяемой.
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.#credentials.accountId,
      client_secret: this.#credentials.apiKey,
      scope: "general",
    });

    const response = await this.#fetch(`${this.#baseUrl}/${TOKEN_ENDPOINT}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!response.ok) {
      throw new HostawayError(`Hostaway authentication failed: HTTP ${response.status}`);
    }

    const payload = await this.#readJson(response);
    const token = (payload as Record<string, unknown>).access_token;
    if (typeof token !== "string" || token === "") {
      throw new HostawayError("Hostaway auth response has no access_token");
    }

    this.#token = token;
    return token;
  }

  async #readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch (cause) {
      throw new HostawayError(`Hostaway returned non-JSON (HTTP ${response.status})`, { cause });
    }
  }

  /**
   * Один запрос с обновлением токена и отступлением при перегрузке.
   *
   * Общий для постраничной выгрузки и выборки одного объекта: правила
   * повторов у них одинаковые, дублировать их было бы источником расхождений.
   */
  async #request(url: string, label: string): Promise<unknown> {
    let attempt = 0;
    let tokenRefreshed = false;

    while (true) {
      await this.#pace();

      const token = await this.#ensureToken();

      // Отметку ставим ДО запроса: лимит считает моменты отправки, поэтому
      // интервал меряется от начала к началу. Если фиксировать после ответа,
      // клиент досыпал бы зазор даже когда сеть уже потратила больше него.
      this.#lastRequestAt = this.#now();

      const response = await this.#fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      // Протухший токен — не перегрузка: обновляем и повторяем сразу, без
      // задержки и не тратя попытку. Второй подряд 401 означает, что дело
      // не в токене, и повторять бессмысленно.
      if (response.status === 401) {
        if (tokenRefreshed) {
          throw new HostawayError(
            `Hostaway still returns 401 with a fresh token (${label}) — check credentials and scope`,
          );
        }

        tokenRefreshed = true;
        this.#token = null;
        continue;
      }

      if (isRetryableStatus(response.status)) {
        attempt += 1;
        if (attempt >= MAX_ATTEMPTS) {
          throw new HostawayError(
            `Hostaway returned ${response.status} after ${attempt} attempts (${label})`,
          );
        }

        await this.#sleep(backoffDelay(attempt));
        continue;
      }

      if (!response.ok) {
        throw new HostawayError(`Hostaway returned HTTP ${response.status} for ${label}`);
      }

      return await this.#readJson(response);
    }
  }

  async #fetchPage(
    endpoint: string,
    limit: number,
    offset: number,
    params: Readonly<Record<string, string>>,
  ): Promise<unknown[]> {
    const query = new URLSearchParams({
      ...params,
      limit: String(limit),
      offset: String(offset),
    });

    const label = `${endpoint} (offset=${offset})`;
    const result = this.#unwrap(await this.#request(`${this.#baseUrl}/${endpoint}?${query}`, label), label);

    if (!Array.isArray(result)) {
      throw new HostawayError(`Field result in the ${label} response is not an array (${typeof result})`);
    }

    return result;
  }

  /** Hostaway умеет отвечать HTTP 200 с телом об ошибке — проверяем поле status. */
  #unwrap(payload: unknown, label: string): unknown {
    if (typeof payload !== "object" || payload === null) {
      throw new HostawayError(`Response body for ${label} is not an object`);
    }

    const body = payload as Record<string, unknown>;
    if (body.status === "fail") {
      throw new HostawayError(`Hostaway rejected request ${label}: ${String(body.result)}`);
    }

    return body.result;
  }
}
