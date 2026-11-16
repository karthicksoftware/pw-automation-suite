import type { Page } from '@playwright/test';
import type { UserDraft } from '../domain/models.js';

/** Registration form and confirmation; fixtures must own cleanup before account creation. */
export class RegistrationPage {
  readonly heading;
  readonly accountCreated;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: /enter account information/i });
    this.accountCreated = page.getByTestId('account-created');
  }

  /** Creates a remote account through the UI; the supplied draft must already have registered cleanup. */
  async createAccount(user: UserDraft) {
    await this.page.locator(user.title === 'Mr' ? '#id_gender1' : '#id_gender2').check();
    await this.page.getByTestId('password').fill(user.password);
    await this.page.getByTestId('days').selectOption(user.birthDate.day);
    await this.page.getByTestId('months').selectOption(user.birthDate.month);
    await this.page.getByTestId('years').selectOption(user.birthDate.year);
    await this.page.getByTestId('first_name').fill(user.firstName);
    await this.page.getByTestId('last_name').fill(user.lastName);
    await this.page.getByTestId('company').fill(user.company);
    await this.page.getByTestId('address').fill(user.address1);
    await this.page.getByTestId('address2').fill(user.address2);
    await this.page.getByTestId('country').selectOption({ label: user.country });
    await this.page.getByTestId('state').fill(user.state);
    await this.page.getByTestId('city').fill(user.city);
    await this.page.getByTestId('zipcode').fill(user.zipcode);
    await this.page.getByTestId('mobile_number').fill(user.mobileNumber);
    await this.page.getByTestId('create-account').click();
  }

  /** Leaves the account-created confirmation and returns to the storefront. */
  async continueToStore() {
    await this.page.getByTestId('continue-button').click();
  }
}
