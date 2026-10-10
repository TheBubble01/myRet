/**
 * Formats a numeric amount into Nigerian Naira (₦) string.
 * Example: 153520 -> "₦153,520" or "₦153,520.00"
 */
export function formatNaira(amount: number, includeDecimals: boolean = false): string {
  if (isNaN(amount) || amount === null || amount === undefined) {
    return '₦0';
  }
  const cleanAmount = Math.max(0, Number(amount));
  
  if (includeDecimals) {
    return `₦${cleanAmount.toLocaleString('en-NG', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  // If there are cents/kobo, show them, otherwise integer format
  const hasCents = cleanAmount % 1 !== 0;
  return `₦${cleanAmount.toLocaleString('en-NG', {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  })}`;
}

/**
 * Parses user input string into valid non-negative float.
 */
export function parseNumber(input: string | number): number {
  if (typeof input === 'number') return isNaN(input) ? 0 : Math.max(0, input);
  if (!input) return 0;
  const cleaned = input.replace(/[^0-9.]/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : Math.max(0, parsed);
}

/**
 * Multiplies quantity and rate with precision safeguards.
 */
export function calculateAmount(quantity: number, rate: number): number {
  const safeQty = Math.max(0, Number(quantity) || 0);
  const safeRate = Math.max(0, Number(rate) || 0);
  return Math.round(safeQty * safeRate * 100) / 100;
}
