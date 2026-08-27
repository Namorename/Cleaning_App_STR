/**
 * Приведение значений из чужого фида.
 *
 * Общее для нормализаторов объектов и броней: Hostaway отдаёт числа то
 * числами, то строками, а «нет значения» выражает то null, то пустой строкой.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Пустая строка и строка из пробелов — это «значения нет», а не значение. */
export function toTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Приведение к числу без ловушек Number(): Number([]) === 0 и Number("") === 0
 * молча превратили бы «нет данных» в осмысленный ноль.
 */
export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Разбор календарной даты Hostaway (`YYYY-MM-DD`).
 *
 * Проверка обратным преобразованием ловит формально верные, но
 * несуществующие даты вроде 2026-02-30, которые Date молча сдвигает.
 */
export function toIsoDate(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`Поле ${field}: ожидалась строка даты, получено ${typeof value}`);
  }

  const trimmed = value.trim();
  if (!ISO_DATE.test(trimmed)) {
    throw new TypeError(`Поле ${field}: дата не в формате YYYY-MM-DD — ${JSON.stringify(value)}`);
  }

  const parsed = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== trimmed) {
    throw new TypeError(`Поле ${field}: несуществующая дата — ${trimmed}`);
  }

  return trimmed;
}
