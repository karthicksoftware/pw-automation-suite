import { test, expect } from '../../src/fixtures/fixtures.js';

test('API-003 creates, retrieves, authenticates and deletes an owned account', async ({
  api,
  userDraft,
}) => {
  const created = await api.accounts.create(userDraft);
  expect(created).toHaveApiOutcome({
    httpStatus: 200,
    responseCode: 201,
    message: 'User created!',
  });

  const retrieved = await api.accounts.getByEmail(userDraft.email);
  expect(retrieved).toHaveApiOutcome({ httpStatus: 200, responseCode: 200 });
  expect(retrieved.body.user).toMatchObject({
    name: userDraft.name,
    email: userDraft.email,
    first_name: userDraft.firstName,
    last_name: userDraft.lastName,
    address1: userDraft.address1,
  });

  const verified = await api.accounts.verifyLogin(userDraft);
  expect(verified).toHaveApiOutcome({
    httpStatus: 200,
    responseCode: 200,
    message: 'User exists!',
  });

  const deleted = await api.accounts.delete(userDraft);
  expect(deleted).toHaveApiOutcome({
    httpStatus: 200,
    responseCode: 200,
    message: 'Account deleted!',
  });

  const afterDeletion = await api.accounts.verifyLogin(userDraft);
  expect(afterDeletion).toHaveApiOutcome({ httpStatus: 200, responseCode: 404 });
});

test('API-004 rejects an incorrect password for an existing account', async ({ api, account }) => {
  const result = await api.accounts.verifyLogin({
    email: account.email,
    password: `${account.password}-incorrect`,
  });
  expect(result).toHaveApiOutcome({
    httpStatus: 200,
    responseCode: 404,
    message: 'User not found!',
  });
});
