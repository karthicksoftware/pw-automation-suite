import type { APIRequestContext } from '@playwright/test';
import { productsSchema } from '../domain/contracts.js';
import { readResponse } from './read-response.js';
import { requestWithRetry, type ApiRetryObserver } from './retry-request.js';

const CATALOG_ROUTES = {
  products: '/api/productsList',
  search: '/api/searchProduct',
} as const;

/** Read-only catalogue operations. Responses are schema-validated; tests choose expected outcomes. */
export class CatalogClient {
  constructor(
    private readonly request: APIRequestContext,
    private readonly observeRetry?: ApiRetryObserver,
  ) {}

  /** Loads the live catalogue, retaining both HTTP status and business responseCode. */
  async products() {
    const response = await requestWithRetry(
      (options) => this.request.get(CATALOG_ROUTES.products, options),
      {
        operation: 'catalog.products',
        method: 'GET',
        path: CATALOG_ROUTES.products,
        observer: this.observeRetry,
      },
    );
    return readResponse(response, productsSchema);
  }

  /** Searches using form encoding; matching includes product names and categories. */
  async search(query: string) {
    const response = await requestWithRetry(
      (options) =>
        this.request.post(CATALOG_ROUTES.search, { ...options, form: { search_product: query } }),
      {
        operation: 'catalog.search',
        method: 'POST',
        path: CATALOG_ROUTES.search,
        observer: this.observeRetry,
      },
    );
    return readResponse(response, productsSchema);
  }
}
