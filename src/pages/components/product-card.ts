import type { Locator } from '@playwright/test';

/** One product card, including duplicate-looking controls scoped to its visible information. */
export class ProductCard {
  readonly name;
  readonly price;
  readonly addToCartButton;
  readonly viewProductLink;

  constructor(readonly root: Locator) {
    const information = root.locator('.productinfo');
    this.name = information.locator('p');
    this.price = information.locator('h2');
    this.addToCartButton = information.getByText('Add to cart', { exact: true });
    this.viewProductLink = root.getByRole('link', { name: /View Product$/ });
  }

  /** Navigates to this product detail page. */
  async openDetails() {
    await this.viewProductLink.click();
  }

  /** Adds one item and opens the cart confirmation modal. */
  async addToCart() {
    await this.addToCartButton.click();
  }
}
