import type { APIRequestContext } from '@playwright/test';
import { productsSchema } from '../domain/contracts.js';
import { readResponse } from './read-response.js';

const CATALOG_ROUTES = {
  products: '/api/productsList',
  search: '/api/searchProduct',
} as const;

/** Read-only catalogue operations. Responses are schema-validated; tests choose expected outcomes. */
export class CatalogClient {
  constructor(private readonly request: APIRequestContext) {}

  /** Loads the live catalogue, retaining both HTTP status and business responseCode. */
  async products() {
    return readResponse(await this.request.get(CATALOG_ROUTES.products), productsSchema);
  }

  /** Searches using form encoding; matching includes product names and categories. */
  async search(query: string) {
    const response = await this.request.post(CATALOG_ROUTES.search, {
      form: { search_product: query },
    });
    return readResponse(response, productsSchema);
  }
}
