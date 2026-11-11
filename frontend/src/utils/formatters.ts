/**
 * Safe numeric formatting helpers for Causara.
 * Correctly handles numbers, numeric strings from SQL/PostgreSQL/LocalDB APIs,
 * null, undefined, and malformed strings without runtime exceptions.
 */

/**
 * Safely parse a value to a finite number.
 * Returns undefined for null, undefined, empty strings, and invalid numeric strings.
 * Preserves genuine zero (0).
 */
export function parseNumeric(value: number | string | null | undefined): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return undefined;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/**
 * Safely format monetary/decimal values with a currency sign and fixed decimals.
 * Handles numbers, numeric strings (e.g. "25.00"), null, undefined, and non-numeric inputs.
 * Preserves genuine zero (0 -> "$0.00").
 */
export function formatCurrency(
  value: number | string | null | undefined,
  decimals: number = 2,
  fallback: string = '—'
): string {
  const num = parseNumeric(value);
  if (num === undefined) {
    return fallback;
  }
  return `$${num.toFixed(decimals)}`;
}

/**
 * Safely format a ratio into an integer percentage string (e.g. 0.88 or "0.8800" -> "88%").
 * Missing or invalid values return fallback (default "—"). Actual zero returns "0%".
 */
export function formatPercentage(
  value: number | string | null | undefined,
  fallback: string = '—'
): string {
  const num = parseNumeric(value);
  if (num === undefined) {
    return fallback;
  }
  return `${Math.round(num * 100)}%`;
}
