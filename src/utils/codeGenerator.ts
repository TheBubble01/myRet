/**
 * Generates human-friendly Retirement Code: RET-XXXXXX
 * Example: RET-7K4M2P
 * Excludes ambiguous chars: 0, O, 1, I, L
 */
export function generateRetirementCode(): string {
  const chars = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  let result = '';
  for (let i = 0; i < 6; i++) {
    const randomIndex = Math.floor(Math.random() * chars.length);
    result += chars[randomIndex];
  }
  return `RET-${result}`;
}

export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
