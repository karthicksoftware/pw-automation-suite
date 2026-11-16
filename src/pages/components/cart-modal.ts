import type { Page } from '@playwright/test';

/** Confirmation dialog shared by catalogue and product-detail add-to-cart actions. */
export class CartModal {
  readonly root;
  readonly heading;

  constructor(page: Page) {
    this.root = page.locator('#cartModal');
    this.heading = this.root.getByRole('heading', { name: 'Added!', exact: true });
  }

  /** Dismisses the confirmation while retaining the current page. */
  async continueShopping() {
    await this.root.getByRole('button', { name: 'Continue Shopping', exact: true }).click();
  }

  /** Navigates from the confirmation dialog to the cart. */
  async viewCart() {
    await this.root.getByRole('link', { name: 'View Cart', exact: true }).click();
  }
}
