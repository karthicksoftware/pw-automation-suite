import type { Page } from '@playwright/test';
import type { PaymentDetails } from '../domain/models.js';

/** Practice-site payment form; use synthetic details only. */
export class PaymentPage {
  readonly heading;
  readonly orderPlaced;
  readonly confirmation;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Payment', exact: true });
    this.orderPlaced = page.getByTestId('order-placed');
    this.confirmation = page.getByText('Congratulations! Your order has been confirmed!', {
      exact: true,
    });
  }

  /** Submits synthetic payment details; the caller verifies the order confirmation. */
  async pay(details: PaymentDetails) {
    await this.page.getByTestId('name-on-card').fill(details.nameOnCard);
    await this.page.getByTestId('card-number').fill(details.cardNumber);
    await this.page.getByTestId('cvc').fill(details.cvc);
    await this.page.getByTestId('expiry-month').fill(details.expiryMonth);
    await this.page.getByTestId('expiry-year').fill(details.expiryYear);
    await this.page.getByTestId('pay-button').click();
  }
}
