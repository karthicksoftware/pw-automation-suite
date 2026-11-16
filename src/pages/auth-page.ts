import type { Page } from '@playwright/test';
import type { Credentials, UserDraft } from '../domain/models.js';

const AUTH_PATH = '/login';

/** Authentication UI. Calling login submits the form; the caller asserts success or rejection. */
export class AuthPage {
  readonly loginHeading;
  readonly loginError;

  constructor(private readonly page: Page) {
    this.loginHeading = page.getByRole('heading', { name: 'Login to your account', exact: true });
    this.loginError = page.getByText('Your email or password is incorrect!', { exact: true });
  }

  /** Opens the login/signup screen in the current isolated context. */
  async goto() {
    await this.page.goto(AUTH_PATH);
  }

  /** Submits credentials through the UI; does not impose a successful-login assertion. */
  async login(credentials: Credentials) {
    await this.page.getByTestId('login-email').fill(credentials.email);
    await this.page.getByTestId('login-password').fill(credentials.password);
    await this.page.getByTestId('login-button').click();
  }

  /** Starts signup and navigates to the account-information form; does not yet create an account. */
  async startSignup(user: UserDraft) {
    await this.page.getByTestId('signup-name').fill(user.name);
    await this.page.getByTestId('signup-email').fill(user.email);
    await this.page.getByTestId('signup-button').click();
  }
}
