import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { apiFixture, userDraftFixture } from '../../src/fixtures/test.js';
import type { ApiRetryHistory } from '../../src/api/retry-request.js';

type FixtureInfo = Parameters<typeof apiFixture>[2];

function response(status: number, payload: unknown): APIResponse {
  // Supply only the transport/parser methods exercised by the real API clients.
  return {
    status: () => status,
    ok: () => status >= 200 && status < 300,
    url: () => 'https://automationexercise.com/api/example',
    headers: () => ({ 'retry-after': '0' }),
    json: () => Promise.resolve(payload),
    dispose: () => Promise.resolve(),
  } as unknown as APIResponse;
}

function createHarness(recoverFrom503 = false, attachmentFailure?: Error) {
  const calls = { catalogue: 0, cleanup: 0 };
  const events: string[] = [];
  const attachments: Parameters<FixtureInfo['attach']>[] = [];
  const request = {
    get: () => {
      calls.catalogue++;
      return Promise.resolve(
        response(recoverFrom503 && calls.catalogue === 1 ? 503 : 200, {
          responseCode: 200,
          products: [],
        }),
      );
    },
    delete: () => {
      calls.cleanup++;
      events.push('cleanup');
      return Promise.resolve(
        response(recoverFrom503 && calls.cleanup === 1 ? 503 : 200, {
          responseCode: 404,
          message: 'Account not found!',
        }),
      );
    },
  } as unknown as APIRequestContext;
  const info: FixtureInfo = {
    attach: (...args) => {
      events.push('attach');
      attachments.push(args);
      return attachmentFailure ? Promise.reject(attachmentFailure) : Promise.resolve();
    },
  };
  return { request, info, calls, events, attachments };
}

await test('the API fixture omits retry attachments when requests succeed on their first attempt', async () => {
  const harness = createHarness();
  await apiFixture(
    harness,
    async (api) => {
      const result = await api.catalog.products();
      assert.equal(result.body.responseCode, 200);
    },
    harness.info,
  );
  assert.equal(harness.calls.catalogue, 1);
  assert.deepEqual(harness.attachments, []);
});

await test('the API fixture includes dependent account cleanup retries in its final attachment', async (context) => {
  context.mock.method(console, 'warn', () => {});
  const harness = createHarness(true);
  await apiFixture(
    harness,
    async (api) => {
      await userDraftFixture(
        { api },
        async () => {
          await api.catalog.products();
          assert.deepEqual(harness.attachments, []);
        },
        {
          ...harness.info,
          workerIndex: 0,
          retry: 0,
          title: 'Offline cleanup retry reporting',
          status: 'passed',
          expectedStatus: 'passed',
        },
      );
    },
    harness.info,
  );
  assert.deepEqual(harness.calls, { catalogue: 2, cleanup: 2 });
  assert.deepEqual(harness.events, ['cleanup', 'cleanup', 'attach']);
  assert.equal(harness.attachments.length, 1);
  const [name, attachment] = harness.attachments[0]!;
  assert.equal(name, 'api-retry-history.json');
  assert.equal(attachment?.contentType, 'application/json');
  assert.ok(Buffer.isBuffer(attachment.body));
  const history = JSON.parse(attachment.body.toString()) as ApiRetryHistory[];
  assert.deepEqual(
    history.map((entry) => [entry.operation, entry.outcome]),
    [
      ['catalog.products', 'recovered'],
      ['accounts.cleanup', 'recovered'],
    ],
  );
  assert.ok(
    history.every(
      (entry) => entry.attempts.map((attempt) => attempt.status).join(',') === '503,200',
    ),
  );
  assert.doesNotMatch(attachment.body.toString(), /email|password/);
});

await test('retry attachment failures fall back to sanitized logs without replacing test outcomes', async (context) => {
  const log = context.mock.method(console, 'warn', () => {});
  const primary = new Error('Original test failure');
  for (const testFails of [false, true]) {
    const harness = createHarness(true, new Error('private-attachment-error'));
    const run = apiFixture(
      harness,
      async (api) => {
        await api.catalog.products();
        if (testFails) throw primary;
      },
      harness.info,
    );
    if (testFails) await assert.rejects(run, (error) => error === primary);
    else await run;
    assert.equal(harness.attachments.length, 1);
  }
  const output = log.mock.calls.map((call) => call.arguments.join(' ')).join('\n');
  assert.equal(output.match(/API retry history attachment failed/g)?.length, 2);
  assert.match(output, /catalog.products/);
  assert.doesNotMatch(output, /private-attachment-error|email|password/);
});
