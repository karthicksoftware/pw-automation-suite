import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { syncBuiltinESMExports } from 'node:module';
import timers from 'node:timers/promises';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { AccountsClient } from '../../src/api/accounts-client.js';
import { CatalogClient } from '../../src/api/catalog-client.js';
import { readResponse } from '../../src/api/read-response.js';
import { requestWithRetry } from '../../src/api/retry-request.js';
import { productsSchema } from '../../src/domain/contracts.js';
import { createUser } from '../../src/data/user-factory.js';

type RequestOptions = NonNullable<Parameters<APIRequestContext['fetch']>[1]>;

function response(status: number, headers: Record<string, string> = {}, payload: unknown = {}) {
  let disposed = 0;
  // This offline transport double supplies only the methods exercised by the clients/parser.
  const value = {
    status: () => status,
    ok: () => status >= 200 && status < 300,
    url: () => 'https://automationexercise.com/api/example',
    headers: () => headers,
    json: () => Promise.resolve(payload),
    dispose: () => {
      disposed++;
      return Promise.resolve();
    },
  } as APIResponse;
  return { value, disposed: () => disposed };
}

function harness(context: TestContext, replies: APIResponse[] = []) {
  let elapsed = 0;
  let wall = Date.parse('Wed, 18 Nov 2026 12:00:00 GMT');
  const waits: number[] = [];
  context.mock.method(performance, 'now', () => elapsed);
  context.mock.method(Date, 'now', () => wall);
  const wait = context.mock.method(timers, 'setTimeout', (milliseconds = 0) => {
    waits.push(milliseconds);
    elapsed += milliseconds;
    wall += milliseconds;
    return Promise.resolve();
  });
  // Synchronize the helper's named ESM import with Node's mocked timer export.
  syncBuiltinESMExports();
  context.after(() => {
    context.mock.restoreAll();
    syncBuiltinESMExports();
  });
  const log = context.mock.method(console, 'warn', () => {});
  const send = (_path: string, _options?: RequestOptions) => {
    const next = replies.shift();
    assert.ok(next, 'Unexpected extra request');
    return Promise.resolve(next);
  };
  const fetch = context.mock.fn(send);
  const request = { fetch } as unknown as APIRequestContext;
  return {
    request,
    fetch,
    send,
    wait,
    waits,
    log,
    advance: (milliseconds: number) => {
      elapsed += milliseconds;
    },
    shiftWall: (milliseconds: number) => {
      wall += milliseconds;
    },
  };
}

await test('503 recovery reduces request timeouts, disposes old responses, and logs one retry', async (context) => {
  const first = response(503);
  const last = response(200);
  const state = harness(context, [first.value, last.value]);
  state.fetch.mock.mockImplementation((path, options) => {
    state.advance(200);
    return state.send(path, options);
  });
  const result = await requestWithRetry(state.request, '/api/productsList', { method: 'GET' });
  assert.equal(result, last.value);
  assert.deepEqual(
    state.fetch.mock.calls.map((call) => call.arguments),
    [
      [
        '/api/productsList',
        { method: 'GET', timeout: 15_000, maxRetries: 0, failOnStatusCode: false },
      ],
      [
        '/api/productsList',
        { method: 'GET', timeout: 13_800, maxRetries: 0, failOnStatusCode: false },
      ],
    ],
  );
  assert.deepEqual(state.waits, [1_000]);
  assert.equal(first.disposed(), 1);
  assert.equal(last.disposed(), 0);
  assert.deepEqual(
    state.log.mock.calls.map((call) => call.arguments),
    [['[api-retry] GET /api/productsList: HTTP 503; retry 1/2']],
  );
});

await test('persistent 503 stops at three attempts without a final wait or extra log', async (context) => {
  const replies = [response(503), response(503), response(503)];
  const state = harness(
    context,
    replies.map((reply) => reply.value),
  );
  const result = await requestWithRetry(state.request, '/api/productsList', { method: 'GET' });
  assert.equal(result, replies[2]!.value);
  assert.equal(state.fetch.mock.callCount(), 3);
  assert.deepEqual(state.waits, [1_000, 2_000]);
  assert.deepEqual(
    replies.map((reply) => reply.disposed()),
    [1, 1, 0],
  );
  assert.deepEqual(
    state.log.mock.calls.map((call) => String(call.arguments[0])),
    [
      '[api-retry] GET /api/productsList: HTTP 503; retry 1/2',
      '[api-retry] GET /api/productsList: HTTP 503; retry 2/2',
    ],
  );
  await assert.rejects(readResponse(result, productsSchema), /HTTP 503/);
});

await test('other HTTP statuses and business rejections return without retries or logs', async (context) => {
  const state = harness(context);
  for (const status of [200, 400, 401, 404, 429, 500, 501, 502, 504, 505]) {
    const reply = response(status, {}, { responseCode: 404, message: 'User not found!' });
    state.fetch.mock.mockImplementation(() => Promise.resolve(reply.value));
    const result = await requestWithRetry(state.request, '/api/example', { method: 'GET' });
    assert.equal(result, reply.value);
    assert.equal(reply.disposed(), 0);
  }
  assert.equal(state.fetch.mock.callCount(), 10);
  assert.deepEqual(state.waits, []);
  assert.equal(state.log.mock.callCount(), 0);
});

await test('a non-503 HTTP rejection following a retry retains its actual response', async (context) => {
  const first = response(503);
  const last = response(400);
  const state = harness(context, [first.value, last.value]);
  const result = await requestWithRetry(state.request, '/api/example', { method: 'GET' });
  assert.equal(result, last.value);
  assert.equal(state.fetch.mock.callCount(), 2);
  assert.equal(first.disposed(), 1);
  assert.equal(last.disposed(), 0);
});

for (const [header, delay] of [
  ['3', 3_000],
  ['0', 0],
  [' 2 ', 2_000],
  ['Wed, 18 Nov 2026 12:00:04 GMT', 4_000],
] as const) {
  await test(`Retry-After ${JSON.stringify(header)} controls the retry delay`, async (context) => {
    const state = harness(context, [
      response(503, { 'retry-after': header }).value,
      response(200).value,
    ]);
    await requestWithRetry(state.request, '/api/example', { method: 'GET' });
    assert.deepEqual(state.waits, [delay]);
    assert.equal(state.fetch.mock.callCount(), 2);
    assert.equal(state.log.mock.callCount(), 1);
  });
}

await test('invalid or past Retry-After values use the 1s/2s fallback', async (context) => {
  const state = harness(context);
  for (const header of ['', 'nonsense', '-1', '1.5', 'Wed, 18 Nov 2026 11:59:59 GMT']) {
    state.fetch.mock.mockImplementation(() =>
      Promise.resolve(response(503, { 'retry-after': header }).value),
    );
    await requestWithRetry(state.request, '/api/example', { method: 'GET' });
  }
  assert.equal(state.fetch.mock.callCount(), 15);
  assert.deepEqual(
    state.waits,
    [1_000, 2_000, 1_000, 2_000, 1_000, 2_000, 1_000, 2_000, 1_000, 2_000],
  );
});

await test('Retry-After consuming or exceeding the budget stops without waiting or logging a retry', async (context) => {
  const state = harness(context);
  for (const header of ['15', '9999999999999999999999', 'Wed, 18 Nov 2026 12:01:00 GMT']) {
    const reply = response(503, { 'retry-after': header });
    state.fetch.mock.mockImplementation(() => Promise.resolve(reply.value));
    assert.equal(
      await requestWithRetry(state.request, '/api/example', { method: 'GET' }),
      reply.value,
    );
    assert.equal(reply.disposed(), 0);
  }
  assert.equal(state.fetch.mock.callCount(), 3);
  assert.deepEqual(state.waits, []);
  assert.equal(state.log.mock.callCount(), 0);
});

await test('a slow 503 request cannot schedule a delay beyond the budget', async (context) => {
  const state = harness(context);
  const reply = response(503);
  state.fetch.mock.mockImplementation(() => {
    state.advance(14_500);
    return Promise.resolve(reply.value);
  });
  assert.equal(
    await requestWithRetry(state.request, '/api/example', { method: 'GET' }),
    reply.value,
  );
  assert.equal(state.fetch.mock.callCount(), 1);
  assert.deepEqual(state.waits, []);
  assert.equal(state.log.mock.callCount(), 0);
});

await test('an overshooting backoff does not send or announce a request after the deadline', async (context) => {
  const reply = response(503);
  const state = harness(context, [reply.value]);
  state.wait.mock.mockImplementation(() => {
    state.advance(15_000);
    return Promise.resolve();
  });
  assert.equal(
    await requestWithRetry(state.request, '/api/example', { method: 'GET' }),
    reply.value,
  );
  assert.equal(state.fetch.mock.callCount(), 1);
  assert.equal(state.log.mock.callCount(), 0);
  assert.equal(reply.disposed(), 0);
});

await test('wall-clock jumps do not change the monotonic request deadline', async (context) => {
  const state = harness(context, [response(503).value, response(200).value]);
  state.fetch.mock.mockImplementation((path, options) => {
    state.shiftWall(-86_400_000);
    return state.send(path, options);
  });
  await requestWithRetry(state.request, '/api/example', { method: 'GET' });
  assert.deepEqual(
    state.fetch.mock.calls.map((call) => call.arguments[1]?.timeout),
    [15_000, 14_000],
  );
});

await test('responses arriving at or after the deadline are rejected and disposed', async (context) => {
  const state = harness(context);
  for (const duration of [15_000, 15_001]) {
    const reply = response(200);
    state.fetch.mock.mockImplementation(() => {
      state.advance(duration);
      return Promise.resolve(reply.value);
    });
    await assert.rejects(
      requestWithRetry(state.request, '/api/example', { method: 'GET' }),
      /deadline exceeded/,
    );
    assert.equal(reply.disposed(), 1);
  }
  assert.equal(state.fetch.mock.callCount(), 2);
  assert.equal(state.log.mock.callCount(), 0);
});

await test('network errors propagate unchanged and dispose any previous 503 response', async (context) => {
  const state = harness(context);
  const error = new Error('private-transport-message');
  for (const failAfter503 of [false, true]) {
    const first = response(503);
    let calls = 0;
    state.fetch.mock.mockImplementation(() => {
      calls++;
      if (failAfter503 && calls === 1) return Promise.resolve(first.value);
      return Promise.reject(error);
    });
    await assert.rejects(
      requestWithRetry(state.request, '/api/example', { method: 'GET' }),
      (caught) => caught === error,
    );
    assert.equal(calls, failAfter503 ? 2 : 1);
    assert.equal(first.disposed(), failAfter503 ? 1 : 0);
  }
  assert.doesNotMatch(
    JSON.stringify(state.log.mock.calls.map((call) => call.arguments)),
    /private-/,
  );
});

await test('a rejected backoff preserves its error and disposes the 503 response', async (context) => {
  const reply = response(503);
  const state = harness(context, [reply.value]);
  const error = new Error('Cancelled backoff');
  state.wait.mock.mockImplementation(() => Promise.reject(error));
  await assert.rejects(
    requestWithRetry(state.request, '/api/example', { method: 'GET' }),
    (caught) => caught === error,
  );
  assert.equal(reply.disposed(), 1);
  assert.equal(state.fetch.mock.callCount(), 1);
  assert.equal(state.log.mock.callCount(), 0);
});

await test('retry messages exclude URL credentials, query, fragment, headers, and body', async (context) => {
  const state = harness(context, [response(503).value, response(200).value]);
  await requestWithRetry(
    state.request,
    'https://private-user:private-pass@automationexercise.com/api/searchProduct?email=private-email#private-fragment',
    {
      method: 'POST',
      headers: { Authorization: 'private-token' },
      form: { search_product: 'private-query' },
    },
  );
  assert.deepEqual(
    state.log.mock.calls.map((call) => call.arguments),
    [['[api-retry] POST /api/searchProduct: HTTP 503; retry 1/2']],
  );
});

await test('request bodies, headers, and query options pass through while the helper owns retry settings', async (context) => {
  const state = harness(context, [response(503).value, response(200).value]);
  const options = {
    method: 'POST',
    data: { search_product: 'top' },
    headers: { 'X-Test': 'demo' },
    params: { page: 1 },
    timeout: 99_999,
    maxRetries: 5,
    failOnStatusCode: true,
  };
  await requestWithRetry(state.request, '/api/searchProduct', options);
  for (const call of state.fetch.mock.calls) {
    assert.deepEqual(call.arguments[1], {
      ...options,
      timeout: call.arguments[1]?.timeout,
      maxRetries: 0,
      failOnStatusCode: false,
    });
    const timeout = call.arguments[1]?.timeout;
    assert.ok(typeof timeout === 'number' && timeout > 0 && timeout <= 15_000);
  }
  assert.equal(options.timeout, 99_999);
  assert.equal(options.maxRetries, 5);
  assert.equal(options.failOnStatusCode, true);
});

await test('clients never retry schema or JSON errors, including after 503 recovery', async (context) => {
  const state = harness(context);
  for (const after503 of [false, true]) {
    for (const payload of [{ responseCode: 200, products: 'wrong-shape' }, null]) {
      const reply = response(200, {}, payload);
      if (payload === null)
        reply.value.json = () => Promise.reject(new SyntaxError('Invalid JSON'));
      let calls = 0;
      state.fetch.mock.mockImplementation(() => {
        calls++;
        return Promise.resolve(after503 && calls === 1 ? response(503).value : reply.value);
      });
      await assert.rejects(new CatalogClient(state.request).products());
      assert.equal(calls, after503 ? 2 : 1);
    }
  }
});

await test('account creation and explicit deletion stay single-shot on HTTP 503', async (context) => {
  const state = harness(context);
  const unavailable = response(503);
  const post = context.mock.fn((_path: string, _options: RequestOptions) =>
    Promise.resolve(unavailable.value),
  );
  const remove = context.mock.fn((_path: string, _options: RequestOptions) =>
    Promise.resolve(unavailable.value),
  );
  const accounts = new AccountsClient({
    fetch: state.fetch,
    post,
    delete: remove,
  } as unknown as APIRequestContext);
  const user = createUser('retry-check', 0, 0);
  await assert.rejects(accounts.create(user), /HTTP 503/);
  await assert.rejects(accounts.delete(user), /HTTP 503/);
  assert.equal(post.mock.callCount(), 1);
  assert.equal(remove.mock.callCount(), 1);
  assert.equal(post.mock.calls[0]!.arguments[0], '/api/createAccount');
  assert.equal(remove.mock.calls[0]!.arguments[0], '/api/deleteAccount');
  assert.equal(post.mock.calls[0]!.arguments[1].maxRetries, 0);
  assert.equal(remove.mock.calls[0]!.arguments[1].maxRetries, 0);
  assert.equal(state.fetch.mock.callCount(), 0);
  assert.deepEqual(state.waits, []);
  assert.equal(state.log.mock.callCount(), 0);
});

const scenarios = [
  {
    operation: 'products',
    method: 'GET',
    path: '/api/productsList',
    input: {},
    payload: { responseCode: 200, products: [] },
  },
  {
    operation: 'search',
    method: 'POST',
    path: '/api/searchProduct',
    input: { form: { search_product: 'top' } },
    payload: { responseCode: 200, products: [] },
  },
  {
    operation: 'details',
    method: 'GET',
    path: '/api/getUserDetailByEmail',
    input: { params: { email: 'owned@example.com' } },
    payload: {
      responseCode: 200,
      user: {
        id: 1,
        name: 'QA',
        email: 'owned@example.com',
        first_name: 'QA',
        last_name: 'User',
        address1: '42 Test Avenue',
        country: 'India',
        state: 'Karnataka',
        city: 'Bengaluru',
        zipcode: '560001',
      },
    },
  },
  {
    operation: 'verify',
    method: 'POST',
    path: '/api/verifyLogin',
    input: { form: { email: 'owned@example.com', password: 'invalid-password' } },
    payload: { responseCode: 404, message: 'User not found!' },
  },
  {
    operation: 'cleanup',
    method: 'DELETE',
    path: '/api/deleteAccount',
    input: { form: { email: 'owned@example.com', password: 'invalid-password' } },
    payload: { responseCode: 404, message: 'Account not found!' },
  },
] as const;

for (const scenario of scenarios) {
  await test(`${scenario.operation} replays identical inputs and preserves the actual business result`, async (context) => {
    const first = response(503);
    const last = response(200, {}, scenario.payload);
    const state = harness(context, [first.value, last.value]);
    const credentials = { email: 'owned@example.com', password: 'invalid-password' };
    state.wait.mock.mockImplementation(() => {
      state.advance(1_000);
      credentials.email = 'changed-after-request@example.com';
      credentials.password = 'changed-after-request';
      return Promise.resolve();
    });
    const accounts = new AccountsClient(state.request);
    const catalog = new CatalogClient(state.request);
    const result = await {
      products: () => catalog.products(),
      search: () => catalog.search('top'),
      details: () => accounts.getByEmail(credentials.email),
      verify: () => accounts.verifyLogin(credentials),
      cleanup: () => accounts.delete(credentials, { retryOn503: true }),
    }[scenario.operation]();
    assert.equal(result.httpStatus, 200);
    assert.deepEqual(result.body, scenario.payload);
    assert.equal(state.fetch.mock.callCount(), 2);
    for (const call of state.fetch.mock.calls) {
      assert.equal(call.arguments[0], scenario.path);
      const { timeout, ...input } = call.arguments[1]!;
      assert.ok(timeout! > 0 && timeout! <= 15_000);
      assert.deepEqual(input, {
        method: scenario.method,
        ...scenario.input,
        maxRetries: 0,
        failOnStatusCode: false,
      });
    }
    assert.equal(first.disposed(), 1);
    assert.equal(last.disposed(), 0);
    assert.equal(state.log.mock.callCount(), 1);
  });
}
