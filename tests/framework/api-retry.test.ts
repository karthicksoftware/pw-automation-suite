import assert from 'node:assert/strict';
import { test } from 'node:test';
import { syncBuiltinESMExports } from 'node:module';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { AccountsClient } from '../../src/api/accounts-client.js';
import { CatalogClient } from '../../src/api/catalog-client.js';
import { readResponse } from '../../src/api/read-response.js';
import { requestWithRetry, type ApiRetryHistory } from '../../src/api/retry-request.js';
import { messageSchema } from '../../src/domain/contracts.js';
import { createUser } from '../../src/data/user-factory.js';

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

function harness() {
  let elapsed = 0;
  let wall = Date.parse('Wed, 18 Nov 2026 12:00:00 GMT');
  const waits: number[] = [];
  const histories: ApiRetryHistory[] = [];
  const clock = {
    now: () => elapsed,
    wallNow: () => wall,
    wait: (milliseconds: number) => {
      waits.push(milliseconds);
      elapsed += milliseconds;
      wall += milliseconds;
      return Promise.resolve();
    },
  };
  const operation = {
    operation: 'catalog.products',
    method: 'GET' as const,
    path: '/api/productsList',
    observer: (history: ApiRetryHistory) => histories.push(history),
  };
  return {
    clock,
    operation,
    waits,
    histories,
    advance: (milliseconds: number) => {
      elapsed += milliseconds;
    },
    shiftWall: (milliseconds: number) => {
      wall += milliseconds;
    },
  };
}

await test('HTTP 503 recovery retries only the request and releases discarded responses', async () => {
  const state = harness();
  const first = response(503);
  const last = response(200);
  const options: { timeout: number; maxRetries: 0 }[] = [];
  const result = await requestWithRetry(
    (attempt) => {
      options.push(attempt);
      state.advance(200);
      return Promise.resolve(options.length === 1 ? first.value : last.value);
    },
    state.operation,
    state.clock,
  );
  assert.equal(result, last.value);
  assert.deepEqual(options, [
    { timeout: 15_000, maxRetries: 0 },
    { timeout: 13_800, maxRetries: 0 },
  ]);
  assert.deepEqual(state.waits, [1_000]);
  assert.equal(first.disposed(), 1);
  assert.equal(last.disposed(), 0);
  assert.equal(state.histories.length, 1);
  assert.equal(state.histories[0]?.outcome, 'recovered');
  assert.deepEqual(
    state.histories[0]?.attempts.map((attempt) => attempt.status),
    [503, 200],
  );
});

await test('persistent 503 stops at three total attempts without a final wait', async () => {
  const state = harness();
  const replies = [response(503), response(503), response(503)];
  let calls = 0;
  const result = await requestWithRetry(
    () => Promise.resolve(replies[calls++]!.value),
    state.operation,
    state.clock,
  );
  assert.equal(result, replies[2]?.value);
  assert.equal(calls, 3);
  assert.deepEqual(state.waits, [1_000, 2_000]);
  assert.deepEqual(
    replies.map((reply) => reply.disposed()),
    [1, 1, 0],
  );
  assert.equal(state.histories[0]?.outcome, 'exhausted');
});

await test('other HTTP statuses and business rejections are never replayed', async () => {
  for (const status of [200, 400, 401, 404, 429, 500, 501, 502, 504, 505]) {
    const state = harness();
    let calls = 0;
    const reply = response(status, {}, { responseCode: 404, message: 'User not found!' });
    const result = await requestWithRetry(
      () => {
        calls++;
        return Promise.resolve(reply.value);
      },
      state.operation,
      state.clock,
    );
    assert.equal(calls, 1);
    assert.equal(result, reply.value);
    assert.deepEqual(state.waits, []);
    assert.deepEqual(state.histories, []);
  }
});

await test('a non-503 rejection following a retry retains its actual response and stopped outcome', async () => {
  const state = harness();
  const replies = [response(503), response(400)];
  let calls = 0;
  const result = await requestWithRetry(
    () => Promise.resolve(replies[calls++]!.value),
    state.operation,
    state.clock,
  );
  assert.equal(result.status(), 400);
  assert.equal(state.histories[0]?.outcome, 'stopped');
  assert.equal(calls, 2);
});

await test('Retry-After seconds/date are honored, including zero seconds', async () => {
  for (const [header, delay] of [
    ['3', 3_000],
    ['0', 0],
    ['Wed, 18 Nov 2026 12:00:04 GMT', 4_000],
  ] as const) {
    const state = harness();
    const replies = [response(503, { 'retry-after': header }), response(200)];
    let calls = 0;
    await requestWithRetry(
      () => Promise.resolve(replies[calls++]!.value),
      state.operation,
      state.clock,
    );
    assert.deepEqual(state.waits, [delay]);
  }
});

await test('invalid or past Retry-After values use bounded fallback delays', async () => {
  for (const header of ['', 'nonsense', '-1', '1.5', 'Wed, 18 Nov 2026 11:59:59 GMT']) {
    const state = harness();
    let calls = 0;
    const reply = response(503, { 'retry-after': header });
    await requestWithRetry(
      () => {
        calls++;
        return Promise.resolve(reply.value);
      },
      state.operation,
      state.clock,
    );
    assert.equal(calls, 3);
    assert.deepEqual(state.waits, [1_000, 2_000]);
  }
});

await test('Retry-After that consumes or exceeds the deadline stops without retrying early', async () => {
  for (const header of ['15', '9999999999999999999999', 'Wed, 18 Nov 2026 12:01:00 GMT']) {
    const state = harness();
    let calls = 0;
    const reply = response(503, { 'retry-after': header });
    assert.equal(
      await requestWithRetry(
        () => {
          calls++;
          return Promise.resolve(reply.value);
        },
        state.operation,
        state.clock,
      ),
      reply.value,
    );
    assert.equal(calls, 1);
    assert.deepEqual(state.waits, []);
    assert.equal(reply.disposed(), 0);
    assert.equal(state.histories[0]?.outcome, 'exhausted');
  }
});

await test('request duration and an overshooting delay cannot start a request past the deadline', async () => {
  const state = harness();
  let calls = 0;
  const reply = response(503);
  await requestWithRetry(
    () => {
      calls++;
      state.advance(14_500);
      return Promise.resolve(reply.value);
    },
    state.operation,
    state.clock,
  );
  assert.equal(calls, 1);
  assert.deepEqual(state.waits, []);
  const overshoot = harness();
  await requestWithRetry(() => Promise.resolve(reply.value), overshoot.operation, {
    ...overshoot.clock,
    wait: () => {
      overshoot.advance(15_000);
      return Promise.resolve();
    },
  });
  assert.equal(overshoot.histories[0]?.attempts.length, 1);
  assert.equal(overshoot.histories[0]?.outcome, 'exhausted');
});

await test('wall-clock jumps do not change the monotonic deadline', async () => {
  const state = harness();
  const timeouts: number[] = [];
  let calls = 0;
  await requestWithRetry(
    (options) => {
      timeouts.push(options.timeout);
      calls++;
      state.shiftWall(-86_400_000);
      return Promise.resolve(response(calls === 1 ? 503 : 200).value);
    },
    state.operation,
    state.clock,
  );
  assert.deepEqual(timeouts, [15_000, 14_000]);
});

await test('a late success is rejected rather than accepted beyond the operation deadline', async () => {
  const state = harness();
  const reply = response(200);
  await assert.rejects(
    requestWithRetry(
      () => {
        state.advance(15_001);
        return Promise.resolve(reply.value);
      },
      state.operation,
      state.clock,
    ),
    /deadline exceeded/,
  );
  assert.equal(reply.disposed(), 1);
});

await test('network/programming errors are propagated without retry and with safe history after a 503', async () => {
  for (const failAfter503 of [false, true]) {
    const state = harness();
    const error = new Error('private-transport-message');
    let calls = 0;
    await assert.rejects(
      requestWithRetry(
        () => {
          calls++;
          if (failAfter503 && calls === 1) return Promise.resolve(response(503).value);
          return Promise.reject(error);
        },
        state.operation,
        state.clock,
      ),
      (caught) => caught === error,
    );
    assert.equal(calls, failAfter503 ? 2 : 1);
    assert.equal(state.histories.length, failAfter503 ? 1 : 0);
    assert.doesNotMatch(JSON.stringify(state.histories), /private-transport-message/);
  }
});

await test('retry diagnostics remove URL credentials/query/fragment and observer errors cannot mask results', async (context) => {
  const state = harness();
  state.operation.path =
    'https://private-user:private-pass@automationexercise.com/api/productsList?email=private-email#private-fragment';
  let calls = 0;
  const log = context.mock.method(console, 'warn', () => {});
  const result = await requestWithRetry(
    () => Promise.resolve(response(++calls === 1 ? 503 : 200).value),
    {
      ...state.operation,
      observer: () => {
        throw new Error('private-observer-error');
      },
    },
    state.clock,
  );
  assert.equal(result.status(), 200);
  const output = JSON.stringify(log.mock.calls.map((call) => call.arguments));
  assert.match(output, /productsList/);
  assert.doesNotMatch(output, /private-|email=/);
  assert.equal(log.mock.callCount(), 1);
});

await test('schema and malformed JSON errors are not retried by clients', async () => {
  for (const payload of [{ responseCode: 200, products: 'wrong-shape' }, null]) {
    let calls = 0;
    const reply = response(200, {}, payload);
    if (payload === null) reply.value.json = () => Promise.reject(new SyntaxError('Invalid JSON'));
    const request = {
      get: () => {
        calls++;
        return Promise.resolve(reply.value);
      },
    } as unknown as APIRequestContext;
    await assert.rejects(new CatalogClient(request).products());
    assert.equal(calls, 1);
  }
});

await test('client replay policies preserve unsafe mutations and explicitly opt cleanup into retry handling', async () => {
  const history: ApiRetryHistory[] = [];
  const calls: { method: string; options: unknown }[] = [];
  const unavailable = response(503, { 'retry-after': '15' });
  const request = Object.fromEntries(
    ['get', 'post', 'delete'].map((method) => [
      method,
      (_url: string, options: unknown) => {
        calls.push({ method, options });
        return Promise.resolve(unavailable.value);
      },
    ]),
  ) as unknown as APIRequestContext;
  const accounts = new AccountsClient(request, (entry) => history.push(entry));
  const user = createUser('retry-check', 0, 0);
  await assert.rejects(accounts.create(user), /HTTP 503/);
  await assert.rejects(accounts.delete(user), /HTTP 503/);
  assert.equal(history.length, 0);
  assert.equal(calls.length, 2);
  for (const call of calls) assert.equal((call.options as { maxRetries: number }).maxRetries, 0);
  await assert.rejects(accounts.delete(user, { retryOn503: true }), /HTTP 503/);
  await assert.rejects(accounts.getByEmail(user.email), /HTTP 503/);
  await assert.rejects(accounts.verifyLogin(user), /HTTP 503/);
  await assert.rejects(
    new CatalogClient(request, (entry) => history.push(entry)).products(),
    /HTTP 503/,
  );
  await assert.rejects(
    new CatalogClient(request, (entry) => history.push(entry)).search('top'),
    /HTTP 503/,
  );
  assert.deepEqual(
    history.map((entry) => entry.operation),
    [
      'accounts.cleanup',
      'accounts.details',
      'accounts.verifyLogin',
      'catalog.products',
      'catalog.search',
    ],
  );
  assert.ok(history.every((entry) => entry.attempts.length === 1 && entry.outcome === 'exhausted'));
  assert.doesNotMatch(JSON.stringify(history), new RegExp(user.email.replaceAll('.', '\\.')));
  assert.doesNotMatch(JSON.stringify(history), new RegExp(user.password));
});

await test('a replayed delete still exposes actual business 404 instead of fabricating 200', async () => {
  const state = harness();
  const replies = [
    response(503),
    response(200, {}, { responseCode: 404, message: 'Account not found!' }),
  ];
  let calls = 0;
  const actual = await requestWithRetry(
    () => Promise.resolve(replies[calls++]!.value),
    { ...state.operation, method: 'DELETE', operation: 'accounts.cleanup' },
    state.clock,
  );
  const parsed = await readResponse(actual, messageSchema);
  assert.equal(parsed.httpStatus, 200);
  assert.equal(parsed.body.responseCode, 404);
});

await test('safe clients replay identical query/form inputs and preserve actual business results', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  // Timer mocks update the builtin module; synchronize its already-imported ESM binding.
  syncBuiltinESMExports();
  context.after(() => {
    context.mock.timers.reset();
    syncBuiltinESMExports();
  });
  const cases = [
    {
      operation: 'search',
      method: 'post',
      path: '/api/searchProduct',
      input: { form: { search_product: 'top' } },
      payload: { responseCode: 200, products: [] },
    },
    {
      operation: 'details',
      method: 'get',
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
      method: 'post',
      path: '/api/verifyLogin',
      input: { form: { email: 'owned@example.com', password: 'invalid-password' } },
      payload: { responseCode: 404, message: 'User not found!' },
    },
    {
      operation: 'cleanup',
      method: 'delete',
      path: '/api/deleteAccount',
      input: { form: { email: 'owned@example.com', password: 'invalid-password' } },
      payload: { responseCode: 404, message: 'Account not found!' },
    },
  ] as const;
  for (const scenario of cases) {
    const calls: {
      method: string;
      path: string;
      options: { timeout: number; maxRetries: number; form?: unknown; params?: unknown };
    }[] = [];
    const histories: ApiRetryHistory[] = [];
    const request = Object.fromEntries(
      ['get', 'post', 'delete'].map((method) => [
        method,
        (path: string, options: (typeof calls)[number]['options']) => {
          calls.push({ method, path, options: structuredClone(options) });
          return Promise.resolve(
            calls.length === 1 ? response(503).value : response(200, {}, scenario.payload).value,
          );
        },
      ]),
    ) as unknown as APIRequestContext;
    const accounts = new AccountsClient(request, (history) => histories.push(history));
    const catalog = new CatalogClient(request, (history) => histories.push(history));
    const credentials = { email: 'owned@example.com', password: 'invalid-password' };
    const pending = {
      search: () => catalog.search('top'),
      details: () => accounts.getByEmail(credentials.email),
      verify: () => accounts.verifyLogin(credentials),
      cleanup: () => accounts.delete(credentials, { retryOn503: true }),
    }[scenario.operation]();
    // Flush promise continuations until the transport schedules its mocked backoff.
    await new Promise<void>((resolve) => setImmediate(resolve));
    credentials.email = 'changed-after-request@example.com';
    credentials.password = 'changed-after-request';
    context.mock.timers.tick(1_000);
    const result = await pending;
    assert.equal(result.body.responseCode, scenario.payload.responseCode);
    assert.equal(calls.length, 2);
    for (const call of calls) {
      const { timeout, ...requestInput } = call.options;
      assert.ok(timeout > 0 && timeout <= 15_000);
      assert.equal(call.method, scenario.method);
      assert.equal(call.path, scenario.path);
      assert.deepEqual(requestInput, { maxRetries: 0, ...scenario.input });
    }
    assert.equal(histories[0]?.outcome, 'recovered');
    assert.equal(histories[0]?.attempts.length, 2);
  }
});

await test('backoff cancellation preserves its error and disposes the discarded response', async () => {
  const state = harness();
  const reply = response(503);
  const error = new Error('Cancelled backoff');
  await assert.rejects(
    requestWithRetry(() => Promise.resolve(reply.value), state.operation, {
      ...state.clock,
      wait: () => Promise.reject(error),
    }),
    (caught) => caught === error,
  );
  assert.equal(reply.disposed(), 1);
  assert.equal(state.histories[0]?.outcome, 'failed');
  assert.equal(state.histories[0]?.attempts.length, 1);
});
