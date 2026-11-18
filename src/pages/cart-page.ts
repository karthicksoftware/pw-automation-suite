import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

const CART_PATH = '/view_cart';

/** Locator-backed product line shared by cart and checkout; validation lives in assertions. */
export class CartRow {
  readonly name;
  readonly unitPrice;
  readonly quantity;
  readonly total;
  readonly qtyDelete;

  constructor(readonly root: Locator) {
    this.name = root.locator('.cart_description h4 a');
    this.unitPrice = root.locator('.cart_price p');
    this.quantity = root.locator('.cart_quantity button');
    this.total = root.locator('.cart_total_price');
    this.qtyDelete = root.locator('.cart_quantity_delete');
  }

  /** Removes this line; the caller verifies disappearance or the empty-cart state. */
  async removeProduct() {
    await expect(this.qtyDelete).toBeVisible();
    await expect(this.qtyDelete).toBeEnabled();
    await this.qtyDelete.click();
  }
}

/** Cart navigation and row selection; each browser context owns its cart session. */
export class CartPage {
  readonly emptyMessage;

  constructor(private readonly page: Page) {
    this.emptyMessage = page.getByText('Cart is empty!', { exact: true });
  }

  /** Opens the cart in the current browser session. */
  async goto() {
    await this.page.goto(CART_PATH);
  }

  /** Returns the locator-backed line for a product, also usable by shared assertions. */
  product(id: number): CartRow {
    return new CartRow(this.page.locator(`#product-${id}`));
  }

  /** Proceeds to checkout; authenticated scenarios should use authenticatedApp first. */
  async proceedToCheckout() {
    await this.page.getByText('Proceed To Checkout', { exact: true }).click();
  }
}
