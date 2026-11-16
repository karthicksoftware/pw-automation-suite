import type { Page } from '@playwright/test';
import { CartRow } from './cart-page.js';

/** Order review before payment; reuses the same CartRow contract as the shopping cart. */
export class CheckoutPage {
  readonly deliveryAddress;
  readonly billingAddress;
  readonly total;

  constructor(private readonly page: Page) {
    this.deliveryAddress = page.locator('#address_delivery');
    this.billingAddress = page.locator('#address_invoice');
    this.total = page.locator('#cart_info .cart_total_price').last();
  }

  /** Returns the order-review line for a catalogue product ID. */
  product(id: number): CartRow {
    return new CartRow(this.page.locator(`#product-${id}`));
  }

  /** Submits the comment and navigates toward payment; the caller verifies the payment screen. */
  async placeOrder(comment: string) {
    await this.page.locator('textarea[name="message"]').fill(comment);
    await this.page.getByRole('link', { name: 'Place Order', exact: true }).click();
  }
}
