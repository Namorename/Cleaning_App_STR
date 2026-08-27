/**
 * Проверка заголовка `Authorization: Basic` (RFC 7617).
 *
 * Единственная защита вебхука Hostaway: подписи там нет вовсе, только пара
 * логин-пароль, задаваемая при регистрации. Поэтому проверка должна быть
 * аккуратной в двух отношениях.
 *
 * Первое — сравнение за постоянное время. Наивное `a === b` прерывается на
 * первом различии, и по времени ответа пароль подбирается посимвольно.
 * Здесь сравниваются SHA-256-дайджесты: они всегда 32 байта, поэтому длина
 * секрета не утекает, а цикл проходит их целиком без досрочного выхода.
 *
 * Второе — причина отказа возвращается наружу. От неё зависит код ответа,
 * а от кода — повторит Hostaway доставку или потеряет бронь навсегда.
 */

export const AUTH_SCHEME = "Basic";

export interface BasicCredentials {
  readonly login: string;
  readonly password: string;
}

export type AuthFailureReason =
  /** Заголовка нет. Обычно значит, что вебхук зарегистрирован без пары логин-пароль. */
  | "missing"
  /** Заголовок есть, но разобрать нельзя: чужая схема, битый base64, нет двоеточия. */
  | "malformed"
  /** Разобрали, но значения не совпали. */
  | "mismatch";

export type AuthResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: AuthFailureReason };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array | null {
  try {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

/** Собирает заголовок так же, как это делает Hostaway: UTF-8, затем base64. */
export function buildBasicAuthHeader(login: string, password: string): string {
  return `${AUTH_SCHEME} ${toBase64(encoder.encode(`${login}:${password}`))}`;
}

/**
 * Сравнение, не зависящее от данных.
 *
 * Дайджест фиксированной длины скрывает длину исходной строки, а накопление
 * различий через XOR не позволяет выйти из цикла раньше времени.
 */
async function equalsInConstantTime(actual: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);

  const left = new Uint8Array(a);
  const right = new Uint8Array(b);

  let difference = 0;
  for (let i = 0; i < left.length; i += 1) {
    difference |= left[i] ^ right[i];
  }

  return difference === 0;
}

export async function verifyBasicAuth(
  header: string | null | undefined,
  expected: BasicCredentials,
): Promise<AuthResult> {
  const trimmed = header?.trim() ?? "";
  if (trimmed === "") {
    return { ok: false, reason: "missing" };
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length !== 2 || parts[0].toLowerCase() !== AUTH_SCHEME.toLowerCase()) {
    return { ok: false, reason: "malformed" };
  }

  const decoded = fromBase64(parts[1]);
  if (decoded === null) {
    return { ok: false, reason: "malformed" };
  }

  const credentials = decoder.decode(decoded);
  const separator = credentials.indexOf(":");
  if (separator === -1) {
    return { ok: false, reason: "malformed" };
  }

  // RFC 7617: логин двоеточий не содержит, пароль — может. Поэтому режем
  // по первому вхождению, а не по всем.
  const login = credentials.slice(0, separator);
  const password = credentials.slice(separator + 1);

  // Обе проверки выполняются всегда: ранний выход после неверного логина
  // сообщал бы подбирающему, что логин угадан.
  const [loginOk, passwordOk] = await Promise.all([
    equalsInConstantTime(login, expected.login),
    equalsInConstantTime(password, expected.password),
  ]);

  return loginOk && passwordOk ? { ok: true } : { ok: false, reason: "mismatch" };
}
