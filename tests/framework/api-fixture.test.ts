import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { apiFixture, userDraftFixture } from '../../src/fixtures/fixtures.js';

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

function createHarness(recoverFrom503 = false) {
  const calls = { catalogue: 0, cleanup: 0 };
  const request = {
    fetch: (path: string) => {
      const catalogue = path === '/api/productsList';
      const attempt = catalogue ? ++calls.catalogue : ++calls.cleanup;
      return Promise.resolve(
        response(
          recoverFrom503 && attempt === 1 ? 503 : 200,
          catalogue
            ? { responseCode: 200, products: [] }
            : { responseCode: 404, message: 'Account not found!' },
        ),
      );
    },
  } as unknown as APIRequestContext;
  return { request, calls };
}

await test('the API fixture supplies clients without logging on first-attempt success', async (context) => {
  const log = context.mock.method(console, 'warn', () => {});
  const harness = createHarness();
  await apiFixture(harness, async (api) => {
    const result = await api.catalog.products();
    assert.equal(result.body.responseCode, 200);
  });
  assert.equal(harness.calls.catalogue, 1);
  assert.equal(log.mock.callCount(), 0);
});

await test('catalogue and dependent cleanup retries log directly', async (context) => {
  const log = context.mock.method(console, 'warn', () => {});
  const harness = createHarness(true);
  await apiFixture(harness, async (api) => {
    await userDraftFixture(
      { api },
      async () => {
        await api.catalog.products();
      },
      {
        workerIndex: 0,
        retry: 0,
      },
    );
  });
  assert.deepEqual(harness.calls, { catalogue: 2, cleanup: 2 });
  assert.deepEqual(
    log.mock.calls.map((call) => call.arguments),
    [
      ['[api-retry] GET /api/productsList: HTTP 503; retry 1/2'],
      ['[api-retry] DELETE /api/deleteAccount: HTTP 503; retry 1/2'],
    ],
  );
});

await test('fixture retries preserve the original test failure and still clean up the owned account', async (context) => {
  const log = context.mock.method(console, 'warn', () => {});
  const harness = createHarness(true);
  const primary = new Error('Original test failure');
  await assert.rejects(
    apiFixture(harness, async (api) => {
      await userDraftFixture(
        { api },
        async () => {
          await api.catalog.products();
          throw primary;
        },
        {
          workerIndex: 0,
          retry: 0,
        },
      );
    }),
    (error) => error === primary,
  );
  assert.deepEqual(harness.calls, { catalogue: 2, cleanup: 2 });
  assert.equal(log.mock.callCount(), 2);
});
