import assert from 'node:assert/strict';
import { test } from 'node:test';
import { userDraftFixture } from '../../src/fixtures/test.js';
import type { Credentials, UserDraft } from '../../src/domain/models.js';

type FixtureDependencies = Parameters<typeof userDraftFixture>[0];
type FixtureInfo = Parameters<typeof userDraftFixture>[2];

function createHarness(
  options: {
    cleanupFailure?: unknown;
    reportingFailure?: Error;
    responseCode?: number;
    httpStatus?: number;
    statusDuringCleanup?: FixtureInfo['status'];
  } = {},
) {
  const deletedUsers: Credentials[] = [];
  const order: string[] = [];
  const attachments: Parameters<FixtureInfo['attach']>[] = [];
  const testInfo: FixtureInfo = {
    workerIndex: 1,
    retry: 0,
    title: 'Offline account fixture check',
    status: 'passed',
    expectedStatus: 'passed',
    attach: (...args) => {
      attachments.push(args);
      return options.reportingFailure
        ? Promise.reject(options.reportingFailure)
        : Promise.resolve();
    },
  };
  const dependencies: FixtureDependencies = {
    api: {
      accounts: {
        delete: (user) => {
          order.push('cleanup');
          deletedUsers.push(user);
          if (options.statusDuringCleanup) testInfo.status = options.statusDuringCleanup;
          if (options.cleanupFailure !== undefined) {
            // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Exercise normalization of non-Error transport failures.
            return Promise.reject(options.cleanupFailure);
          }
          return Promise.resolve({
            httpStatus: options.httpStatus ?? 200,
            body: { responseCode: options.responseCode ?? 200, message: 'Account deleted!' },
          });
        },
      },
    },
  };
  return { dependencies, testInfo, deletedUsers, order, attachments };
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
        return Promise.resolve();
      },
      harness.testInfo,
    );
    assert.ok(ownedUser);
    assert.deepEqual(harness.order, ['use', 'cleanup']);
    assert.equal(harness.deletedUsers.length, 1);
    assert.equal(harness.deletedUsers[0], ownedUser);
    assert.deepEqual(harness.attachments, []);
  }
});

await test('runs cleanup after a provisioning failure and preserves the primary error', async () => {
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

await test('cleanup failure fails an otherwise successful scenario and is reported', async (context) => {
  const cleanupFailure = new Error('Delete endpoint is unavailable');
  const harness = createHarness({ cleanupFailure });
  const log = context.mock.method(console, 'error', () => {});
  await assert.rejects(
    userDraftFixture(harness.dependencies, () => Promise.resolve(), harness.testInfo),
    (error: unknown) => error === cleanupFailure,
  );
  assert.equal(harness.attachments.length, 1);
  assert.deepEqual(harness.attachments[0], [
    'account-cleanup-failure',
    { body: Buffer.from(cleanupFailure.message), contentType: 'text/plain' },
  ]);
  assert.equal(log.mock.callCount(), 1);
});

await test('cleanup failure does not replace a failing test body', async (context) => {
  const primary = new Error('Order assertion failed');
  const harness = createHarness({ cleanupFailure: new Error('Delete endpoint unavailable') });
  context.mock.method(console, 'error', () => {});
  await assert.rejects(
    userDraftFixture(harness.dependencies, () => Promise.reject(primary), harness.testInfo),
    (error: unknown) => error === primary,
  );
  assert.equal(harness.attachments.length, 1);
});

await test('respects a Playwright test failure even when the fixture use callback resolves', async (context) => {
  const harness = createHarness({ cleanupFailure: new Error('Cleanup unavailable') });
  context.mock.method(console, 'error', () => {});
  await userDraftFixture(
    harness.dependencies,
    () => {
      harness.testInfo.status = 'failed';
      return Promise.resolve();
    },
    harness.testInfo,
  );
  assert.equal(harness.attachments.length, 1);
});

await test('an attachment failure cannot mask the primary scenario error', async (context) => {
  const primary = new Error('Primary checkout assertion failure');
  const harness = createHarness({
    cleanupFailure: new Error('Cleanup unavailable'),
    reportingFailure: new Error('Attachment unavailable'),
  });
  const log = context.mock.method(console, 'error', () => {});
  await assert.rejects(
    userDraftFixture(harness.dependencies, () => Promise.reject(primary), harness.testInfo),
    (error: unknown) => error === primary,
  );
  assert.equal(harness.attachments.length, 1);
  assert.match(String(log.mock.calls[0]?.arguments[0]), /diagnostic reporting also failed/);
});

await test('reports both failures when cleanup and its attachment fail on a passing scenario', async () => {
  const cleanupFailure = new Error('Cleanup unavailable');
  const reportingFailure = new Error('Attachment unavailable');
  const harness = createHarness({ cleanupFailure, reportingFailure });
  await assert.rejects(
    userDraftFixture(harness.dependencies, () => Promise.resolve(), harness.testInfo),
    (error: unknown) =>
      error instanceof AggregateError &&
      error.errors[0] === cleanupFailure &&
      error.errors[1] === reportingFailure,
  );
});

await test('reporting failures preserve failed, timed-out, and interrupted test outcomes', async (context) => {
  const log = context.mock.method(console, 'error', () => {});
  for (const status of ['failed', 'timedOut', 'interrupted'] as const) {
    const harness = createHarness({
      cleanupFailure: new Error('Cleanup unavailable'),
      reportingFailure: new Error('Attachment unavailable'),
    });
    await userDraftFixture(
      harness.dependencies,
      () => {
        harness.testInfo.status = status;
        return Promise.resolve();
      },
      harness.testInfo,
    );
    assert.equal(harness.testInfo.status, status);
    assert.equal(harness.deletedUsers.length, 1);
    assert.equal(harness.attachments.length, 1);
  }
  assert.equal(log.mock.callCount(), 3);
});

await test('a failure recorded during account deletion is preserved', async (context) => {
  const harness = createHarness({
    statusDuringCleanup: 'timedOut',
    cleanupFailure: new Error('Cleanup unavailable'),
    reportingFailure: new Error('Attachment unavailable'),
  });
  context.mock.method(console, 'error', () => {});
  await userDraftFixture(harness.dependencies, () => Promise.resolve(), harness.testInfo);
  assert.equal(harness.testInfo.status, 'timedOut');
  assert.equal(harness.attachments.length, 1);
  assert.equal(harness.deletedUsers.length, 1);
});

await test('invalid deletion outcomes fail teardown and non-Error failures are normalized', async (context) => {
  context.mock.method(console, 'error', () => {});
  for (const outcome of [{ responseCode: 500 }, { httpStatus: 503 }]) {
    const invalid = createHarness(outcome);
    await assert.rejects(
      userDraftFixture(invalid.dependencies, () => Promise.resolve(), invalid.testInfo),
      /Clean up owned account/,
    );
    assert.equal(invalid.attachments.length, 1);
  }
  const nonError = createHarness({ cleanupFailure: 'Transport unavailable' });
  await assert.rejects(
    userDraftFixture(nonError.dependencies, () => Promise.resolve(), nonError.testInfo),
    (error: unknown) => error instanceof Error && error.message === 'Transport unavailable',
  );
});
