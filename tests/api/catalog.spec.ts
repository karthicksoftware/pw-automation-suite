import { test, expect } from '../../src/fixtures/test.js';
import { rupeesToPaise } from '../../src/domain/money.js';

test('API-001 returns a valid product catalogue with unique IDs', async ({ api }) => {
  const result = await api.catalog.products();
  expect(result).toHaveApiOutcome({ httpStatus: 200, responseCode: 200 });
  expect(result.body.products.length).toBeGreaterThan(0);
  const ids = result.body.products.map((product) => product.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(result.body.products.every((product) => rupeesToPaise(product.price) > 0)).toBe(true);
});

test('API-002 searches products using a form-encoded query', async ({ api }) => {
  const catalogue = await api.catalog.products();
  expect(catalogue).toHaveApiOutcome({ httpStatus: 200, responseCode: 200 });
  const result = await api.catalog.search('top');
  expect(result).toHaveApiOutcome({ httpStatus: 200, responseCode: 200 });
  expect(result.body.products.length).toBeGreaterThan(0);
  // Search includes category matches, e.g. "Little Girls Mr. Panda Shirt" in Tops.
  const expectedIds = catalogue.body.products
    .filter((product) =>
      [product.name, product.category.category].some((value) =>
        value.toLowerCase().includes('top'),
      ),
    )
    .map((product) => product.id)
    .sort((left, right) => left - right);
  expect(
    result.body.products.map((product) => product.id).sort((left, right) => left - right),
  ).toEqual(expectedIds);
});
