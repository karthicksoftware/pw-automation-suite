/** Convert display rupees to integer paise; never compare money using floating point. */
export function rupeesToPaise(text: string): number {
  const match = /^Rs\.\s*(\d+|\d{1,3}(?:,\d{3})+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match?.[1]) throw new Error(`Unsupported rupee amount: ${text}`);
  const whole = Number(match[1].replaceAll(',', ''));
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  const value = whole * 100 + fraction;
  if (!Number.isSafeInteger(value)) throw new Error('Rupee amount exceeds safe integer precision');
  return value;
}
