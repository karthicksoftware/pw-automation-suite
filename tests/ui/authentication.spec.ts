import { test, expect } from '../../src/fixtures/test.js';

test('UI-002 logs in and logs out a provisioned customer', async ({ app, account }) => {
  await app.auth.goto();
  await expect(app.auth.loginHeading).toBeVisible();
  await app.auth.login(account);
  await expect(app.header.loggedInUser).toContainText(account.name);
  await app.header.logout();
  await expect(app.auth.loginHeading).toBeVisible();
  await expect(app.header.loggedInUser).toHaveCount(0);
  await expect(app.header.signupOrLogin).toBeVisible();
});
