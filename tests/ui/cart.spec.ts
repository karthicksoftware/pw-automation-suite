import { test, expect, expectCartLine } from '../../src/fixtures/test.js';
import { rupeesToPaise } from '../../src/domain/money.js';

test('UI-004 calculates cart quantities and totals and removes a product', async ({
  app,
  product,
}) => {
  const quantity = 3;
  await app.productDetails.goto(product.id);
  await app.productDetails.addToCart(quantity);
  await expect(app.cartModal.heading).toBeVisible();
  await app.cartModal.viewCart();

  const row = app.cart.product(product.id);
  await expectCartLine(row, {
    name: product.name,
    quantity,
    unitPrice: product.price,
    totalPaise: rupeesToPaise(product.price) * quantity,
  });

  await row.removeProduct();
  await expect(row.root).toHaveCount(0);
  await expect(app.cart.emptyMessage).toBeVisible();
});
