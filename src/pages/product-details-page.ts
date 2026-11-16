import type { Page } from '@playwright/test';

const productDetailsPath = (id: number) => `/product_details/${id}`;

/** Product-detail interactions; adding a product opens the shared cart confirmation modal. */
export class ProductDetailsPage {
  readonly name;
  readonly price;

  constructor(private readonly page: Page) {
    const information = page.locator('.product-information');
    this.name = information.getByRole('heading', { level: 2 });
    this.price = information.locator(':scope > span > span');
  }

  /** Opens the detail page for a catalogue product ID. */
  async goto(id: number) {
    await this.page.goto(productDetailsPath(id));
  }

  /** Sets the requested quantity and adds it; the caller handles the cart modal and assertions. */
  async addToCart(quantity = 1) {
    await this.page.locator('#quantity').fill(String(quantity));
    await this.page.getByRole('button', { name: /Add to cart$/ }).click();
  }
}
