import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toCreateAccountForm, toCredentialsForm } from '../../src/api/accounts-client.js';
import { expect } from '../../src/assertions/api-expect.js';
import { createUser } from '../../src/data/user-factory.js';

await test('registration mapping preserves every API field and leaves domain data unchanged', () => {
  const user = createUser('payload-check', 0, 0);
  const original = structuredClone(user);
  assert.deepEqual(toCreateAccountForm(user), {
    name: user.name,
    email: user.email,
    password: user.password,
    title: user.title,
    birth_date: user.birthDate.day,
    birth_month: user.birthDate.month,
    birth_year: user.birthDate.year,
    firstname: user.firstName,
    lastname: user.lastName,
    company: user.company,
    address1: user.address1,
    address2: user.address2,
    country: user.country,
    zipcode: user.zipcode,
    state: user.state,
    city: user.city,
    mobile_number: user.mobileNumber,
  });
  assert.deepEqual(user, original);
});

await test('credential mapping strips extra user fields and preserves an intentionally wrong password', () => {
  const user = createUser('credentials-check', 0, 0);
  const invalid = { ...user, password: `${user.password}-incorrect` };
  assert.deepEqual(toCredentialsForm(invalid), { email: user.email, password: invalid.password });
  assert.deepEqual(Object.keys(toCredentialsForm(user)).sort(), ['email', 'password']);
});

await test('API matcher supports successful, business-rejected, message-free, and negated outcomes', () => {
  expect({
    httpStatus: 200,
    body: { responseCode: 201, message: 'User created!' },
  }).toHaveApiOutcome({ httpStatus: 200, responseCode: 201, message: 'User created!' });
  const rejected = { httpStatus: 200, body: { responseCode: 404, message: 'User not found!' } };
  expect(rejected).toHaveApiOutcome({
    httpStatus: 200,
    responseCode: 404,
    message: 'User not found!',
  });
  expect({ httpStatus: 200, body: { responseCode: 200, products: [] } }).toHaveApiOutcome({
    httpStatus: 200,
    responseCode: 200,
  });
  expect(rejected).not.toHaveApiOutcome({ httpStatus: 200, responseCode: 200 });
  assert.throws(() =>
    expect(rejected).not.toHaveApiOutcome({ httpStatus: 200, responseCode: 404 }),
  );
});

await test('API matcher detects each mismatched field and reports only the selected outcome', () => {
  const received = {
    httpStatus: 200,
    body: { responseCode: 201, message: 'User created!', password: 'must-never-be-in-diagnostics' },
  };
  for (const expected of [
    { httpStatus: 503, responseCode: 201 },
    { httpStatus: 200, responseCode: 404 },
    { httpStatus: 200, responseCode: 201, message: 'Incorrect message' },
  ]) {
    assert.throws(
      () => expect(received).toHaveApiOutcome(expected),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /toHaveApiOutcome/);
        assert.match(error.message, /Expected outcome/);
        assert.match(error.message, /Received outcome/);
        assert.doesNotMatch(error.message, /must-never-be-in-diagnostics/);
        return true;
      },
    );
  }
});

await test('missing message never satisfies an explicitly expected empty message', () => {
  const received = { httpStatus: 200, body: { responseCode: 200 } };
  assert.throws(() =>
    expect(received).toHaveApiOutcome({ httpStatus: 200, responseCode: 200, message: '' }),
  );
  expect(received).toHaveApiOutcome({ httpStatus: 200, responseCode: 200 });
});
