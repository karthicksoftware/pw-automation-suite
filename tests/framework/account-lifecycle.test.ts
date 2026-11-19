import assert from 'node:assert/strict';
import { test } from 'node:test';
import { userDraftFixture } from '../../src/fixtures/fixtures.js';
import type { Credentials, UserDraft } from '../../src/domain/models.js';

type FixtureDependencies = Parameters<typeof userDraftFixture>[0];
type FixtureInfo = Parameters<typeof userDraftFixture>[2];

function createHarness(
  options: { cleanupFailure?: Error; responseCode?: number; httpStatus?: number } = {},
) {
  const deletedUsers: Credentials[] = [];
  const cleanupRetries: boolean[] = [];
  const order: string[] = [];
  const testInfo: FixtureInfo = { workerIndex: 1, retry: 0 };
  const dependencies: FixtureDependencies = {
    api: {
      accounts: {
        delete: (user, deleteOptions) => {
          order.push('cleanup');
          deletedUsers.push(user);
          cleanupRetries.push(deleteOptions?.retryOn503 === true);
          if (options.cleanupFailure) return Promise.reject(options.cleanupFailure);
          return Promise.resolve({
            httpStatus: options.httpStatus ?? 200,
            body: { responseCode: options.responseCode ?? 200, message: 'Account deleted!' },
          });
        },
      },
    },
  };
  return { dependencies, testInfo, deletedUsers, cleanupRetries, order };
}

await test('the fixture deletes its owned identity after use and accepts an already absent account', async () => {
  for (const responseCode of [200, 404]) {
    const harness = createHarness({ responseCode });
    let ownedUser: UserDraft | undefined;
    await userDraftFixture(
      harness.dependencies,
      (user) => {
        ownedUser = user;
        harness.order.push('use');
        assert.deepEqual(harness.deletedUsers, []);
        return Promise.resolve();
      },
      harness.testInfo,
    );
    assert.ok(ownedUser);
    assert.deepEqual(harness.order, ['use', 'cleanup']);
    assert.equal(harness.deletedUsers.length, 1);
    assert.equal(harness.deletedUsers[0], ownedUser);
    assert.deepEqual(harness.cleanupRetries, [true]);
  }
});

await test('runs cleanup after a provisioning failure and preserves the primary error when cleanup succeeds', async () => {
  const primary = new Error('Provisioning failed after creating an account');
  const harness = createHarness();
  await assert.rejects(
    userDraftFixture(
      harness.dependencies,
      () => {
        harness.order.push('provision');
        return Promise.reject(primary);
      },
      harness.testInfo,
    ),
    (error: unknown) => error === primary,
  );
  assert.deepEqual(harness.order, ['provision', 'cleanup']);
  assert.equal(harness.deletedUsers.length, 1);
});

await test('cleanup failure rejects an otherwise successful fixture', async () => {
  const cleanupFailure = new Error('Delete endpoint is unavailable');
  const harness = createHarness({ cleanupFailure });
  await assert.rejects(
    userDraftFixture(harness.dependencies, () => Promise.resolve(), harness.testInfo),
    (error: unknown) => error === cleanupFailure,
  );
  assert.equal(harness.deletedUsers.length, 1);
  assert.deepEqual(harness.cleanupRetries, [true]);
});

await test('invalid HTTP or business deletion outcomes reject teardown', async () => {
  for (const outcome of [{ responseCode: 500 }, { httpStatus: 503 }]) {
    const harness = createHarness(outcome);
    await assert.rejects(
      userDraftFixture(harness.dependencies, () => Promise.resolve(), harness.testInfo),
      /Clean up owned account/,
    );
    assert.equal(harness.deletedUsers.length, 1);
  }
});
