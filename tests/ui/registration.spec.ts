import { test, expect } from '../../src/fixtures/fixtures.js';

test('UI-001 registers a new customer', async ({ app, userDraft, api }) => {
  await app.auth.goto();
  await app.auth.startSignup(userDraft);
  await expect(app.registration.heading).toBeVisible();
  await app.registration.createAccount(userDraft);
  await expect(app.registration.accountCreated).toBeVisible();
  await app.registration.continueToStore();
  await expect(app.header.loggedInUser).toContainText(userDraft.name);

  const registered = await api.accounts.getByEmail(userDraft.email);
  expect(registered).toHaveApiOutcome({ httpStatus: 200, responseCode: 200 });
  expect(registered.body.user.email).toBe(userDraft.email);
});
