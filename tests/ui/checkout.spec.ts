import { test, expect, expectCartLine } from '../../src/fixtures/test.js';
import { createPayment } from '../../src/data/user-factory.js';
import { rupeesToPaise } from '../../src/domain/money.js';

test('UI-005 checks out an order with the correct address and total', async ({
  authenticatedApp: app,
  account,
  product,
}) => {
  test.setTimeout(120_000);
  const quantity = 2;
  await app.productDetails.goto(product.id);
  await app.productDetails.addToCart(quantity);
  await app.cartModal.viewCart();
  await app.cart.proceedToCheckout();

  await expect(app.checkout.deliveryAddress).toContainText(
    `${account.firstName} ${account.lastName}`,
  );
  await expect(app.checkout.deliveryAddress).toContainText(account.address1);
  await expect(app.checkout.deliveryAddress).toContainText(account.country);
  await expect(app.checkout.billingAddress).toContainText(account.address1);
  await expect(app.checkout.billingAddress).toContainText(account.zipcode);
  const row = app.checkout.product(product.id);
  const expectedTotal = rupeesToPaise(product.price) * quantity;
  await expectCartLine(row, {
    name: product.name,
    quantity,
    totalPaise: expectedTotal,
  });
  expect(rupeesToPaise(await app.checkout.total.innerText())).toBe(expectedTotal);

  await app.checkout.placeOrder('Synthetic order created by an isolated automated test.');
  await expect(app.payment.heading).toBeVisible();
  await app.payment.pay(createPayment(account.name));
  await expect(app.payment.orderPlaced).toBeVisible();
  await expect(app.payment.confirmation).toBeVisible();
});
