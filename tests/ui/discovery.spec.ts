import { test, expect } from '../../src/fixtures/fixtures.js';
import { rupeesToPaise } from '../../src/domain/money.js';

test('UI-003 discovers a product through search and verifies its details', async ({
  app,
  product,
  api,
}) => {
  const searchQuery = product.name;
  const expected = await api.catalog.search(searchQuery);
  expect(expected).toHaveApiOutcome({ httpStatus: 200, responseCode: 200 });
  expect(expected.body.products.length).toBeGreaterThan(0);
  await app.products.goto();
  await expect(app.products.heading).toBeVisible();
  await app.products.search(searchQuery);
  await expect(app.products.searchResultsHeading).toBeVisible();
  await expect(app.products.names).not.toHaveCount(0);
  await expect(app.products.names).toHaveText(expected.body.products.map((item) => item.name));

  const card = app.products.product(product.id);
  await expect(card.name).toHaveText(product.name);
  await expect(card.price).toHaveText(product.price);
  await card.openDetails();
  await expect(app.productDetails.name).toHaveText(product.name);
  await expect(app.productDetails.price).toHaveText(product.price);
  expect(rupeesToPaise(await app.productDetails.price.innerText())).toBe(
    rupeesToPaise(product.price),
  );
});
