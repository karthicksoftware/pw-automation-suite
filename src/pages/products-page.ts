import type { Page } from '@playwright/test';
import { ProductCard } from './components/product-card.js';

const PRODUCTS_PATH = '/products';

/** Catalogue browsing and search; product controls are scoped to individual cards. */
export class ProductsPage {
  readonly heading;
  readonly searchResultsHeading;
  readonly names;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'All Products', exact: true });
    this.searchResultsHeading = page.getByRole('heading', {
      name: 'Searched Products',
      exact: true,
    });
    this.names = page.locator('.features_items .productinfo p');
  }

  /** Opens the full catalogue; the caller asserts page readiness. */
  async goto() {
    await this.page.goto(PRODUCTS_PATH);
  }

  /** Submits a search; results may match category names as well as product names. */
  async search(query: string) {
    await this.page.locator('#search_product').fill(query);
    await this.page.locator('#submit_search').click();
  }

  /** Returns a card scoped by the API product ID, avoiding duplicate overlay controls. */
  product(id: number): ProductCard {
    const root = this.page.locator('.features_items .product-image-wrapper').filter({
      has: this.page.locator(`a[data-product-id="${id}"]`),
    });
    return new ProductCard(root);
  }
}
