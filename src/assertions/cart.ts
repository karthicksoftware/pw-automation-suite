import { expect } from '@playwright/test';
import type { CartRow } from '../pages/cart-page.js';
import { rupeesToPaise } from '../domain/money.js';

export interface CartLineExpectation {
  readonly name: string;
  readonly quantity: number;
  readonly totalPaise: number;
  readonly unitPrice?: string;
}

/** Checks a cart/checkout line with web-first assertions and a polled integer-paise total. */
export async function expectCartLine(row: CartRow, expected: CartLineExpectation): Promise<void> {
  await expect(row.name).toHaveText(expected.name);
  await expect(row.quantity).toHaveText(String(expected.quantity));
  if (expected.unitPrice !== undefined) await expect(row.unitPrice).toHaveText(expected.unitPrice);
  await expect
    .poll(async () => rupeesToPaise(await row.total.innerText()))
    .toBe(expected.totalPaise);
}
