import type { Page } from '@playwright/test';

/** Shared storefront navigation and displayed authentication state. */
export class Header {
  readonly root;
  readonly loggedInUser;
  readonly signupOrLogin;
  readonly logoutLink;

  constructor(page: Page) {
    this.root = page.locator('header');
    this.loggedInUser = this.root.getByText('Logged in as', { exact: false });
    // The app includes decorative icon glyphs in these accessible names.
    this.signupOrLogin = this.root.getByRole('link', { name: /Signup \/ Login$/ });
    this.logoutLink = this.root.getByRole('link', { name: /Logout$/ });
  }

  /** Ends the current browser login session; the caller verifies the signed-out screen. */
  async logout() {
    await this.logoutLink.click();
  }
}
