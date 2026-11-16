import assert from 'node:assert/strict';
import { test } from 'node:test';
import { productFixture } from '../../src/fixtures/test.js';
import type { Product } from '../../src/domain/contracts.js';

const products: Product[] = [
  {
    id: 42,
    name: 'Everyday Shirt',
    price: 'Rs. 750',
    brand: 'Example Brand',
    category: { usertype: { usertype: 'Unisex' }, category: 'Shirts' },
  },
  {
    id: 7,
    name: 'Linen Trousers',
    price: 'Rs. 1200',
    brand: 'Another Brand',
    category: { usertype: { usertype: 'Unisex' }, category: 'Trousers' },
  },
];

await test('product fixture uses live catalogue order without requiring a fixed name or ID', async (context) => {
  const original = structuredClone(products);
  for (const catalogue of [products, [...products].reverse()]) {
    const loadCatalogue = context.mock.fn(() =>
      Promise.resolve({ httpStatus: 200, body: { responseCode: 200, products: catalogue } }),
    );
    const use = context.mock.fn((product: Product) => {
      assert.equal(product, catalogue[0]);
      return Promise.resolve();
    });
    await productFixture({ api: { catalog: { products: loadCatalogue } } }, use);
    assert.equal(loadCatalogue.mock.callCount(), 1);
    assert.equal(use.mock.callCount(), 1);
  }
  assert.deepEqual(products, original);
});

await test('product fixture reports an empty catalogue before running the test body', async (context) => {
  const use = context.mock.fn(() => Promise.resolve());
  const api = {
    catalog: {
      products: () =>
        Promise.resolve({ httpStatus: 200, body: { responseCode: 200, products: [] } }),
    },
  };
  await assert.rejects(productFixture({ api }, use), /the catalogue is empty/);
  assert.equal(use.mock.callCount(), 0);
});

await test('product fixture rejects transport and business failures before selecting a product', async (context) => {
  for (const outcome of [
    { httpStatus: 503, responseCode: 200 },
    { httpStatus: 200, responseCode: 404 },
  ]) {
    const use = context.mock.fn(() => Promise.resolve());
    const api = {
      catalog: {
        products: () =>
          Promise.resolve({
            httpStatus: outcome.httpStatus,
            body: { responseCode: outcome.responseCode, products },
          }),
      },
    };
    await assert.rejects(productFixture({ api }, use), /Load product fixture/);
    assert.equal(use.mock.callCount(), 0);
  }
});
