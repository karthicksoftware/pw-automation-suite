import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { syncBuiltinESMExports } from 'node:module';
import timers from 'node:timers/promises';
import type { Frame, Locator, Page, Request, Response } from '@playwright/test';
import { installQueueRecovery } from '../../src/pages/queue-full-page.js';
import { uiRecoveryConfig } from '../../src/config/ui-recovery.js';

const BASE_URL = 'https://automationexercise.com';

interface DocumentOptions {
  url?: string;
  method?: string;
  status?: number;
  queue?: boolean;
  headers?: Record<string, string>;
  navigation?: boolean;
  mainFrame?: boolean;
  redirectedFrom?: Request;
  durationMs?: number;
}

function harness(context: TestContext, replies: DocumentOptions[] = []) {
  let elapsed = 0;
  let wall = Date.parse('Wed, 18 Nov 2026 12:00:00 GMT');
  let visible = true;
  let url = `${BASE_URL}/products`;
  let onResponse: ((response: Response) => void) | undefined;
  let handler: (() => Promise<unknown>) | undefined;
  const frame = {} as Frame;
  const waits: number[] = [];
  context.mock.method(performance, 'now', () => elapsed);
  context.mock.method(Date, 'now', () => wall);
  const wait = context.mock.method(timers, 'setTimeout', (milliseconds = 0) => {
    waits.push(milliseconds);
    elapsed += milliseconds;
    wall += milliseconds;
    return Promise.resolve();
  });
  syncBuiltinESMExports();
  context.after(() => {
    context.mock.restoreAll();
    syncBuiltinESMExports();
  });
  const log = context.mock.method(console, 'warn', () => {});
  function response(options: DocumentOptions): Response {
    const request = {
      url: () => options.url ?? `${BASE_URL}/products`,
      method: () => options.method ?? 'GET',
      isNavigationRequest: () => options.navigation ?? true,
      redirectedFrom: () => options.redirectedFrom ?? null,
    } as Request;
    return {
      url: () => request.url(),
      request: () => request,
      status: () => options.status ?? 503,
      headers: () => options.headers ?? {},
      frame: () => (options.mainFrame === false ? ({} as Frame) : frame),
    } as unknown as Response;
  }
  function showDocument(options: DocumentOptions): Response {
    url = options.url ?? `${BASE_URL}/products`;
    visible = options.queue ?? true;
    const value = response(options);
    assert.ok(onResponse);
    onResponse(value);
    return value;
  }
  const reload = context.mock.fn((_options: Parameters<Page['reload']>[0]) => {
    const next = replies.shift();
    assert.ok(next, 'Unexpected extra reload');
    elapsed += next.durationMs ?? 0;
    return Promise.resolve(showDocument(next));
  });
  const page = {
    mainFrame: () => frame,
    url: () => url,
    on: (_event: string, listener: (response: Response) => void) => {
      onResponse = listener;
    },
    getByRole: (_role: string, options: unknown) => {
      assert.deepEqual(options, {
        name: 'This website is under heavy load (queue full)',
        exact: true,
      });
      return { isVisible: () => Promise.resolve(visible) } as Locator;
    },
    addLocatorHandler: (_locator: Locator, callback: () => Promise<unknown>) => {
      handler = callback;
      return Promise.resolve();
    },
    reload,
  } as unknown as Page;
  return {
    page,
    reload,
    log,
    wait,
    waits,
    response,
    showDocument,
    emit: (options: DocumentOptions) => {
      assert.ok(onResponse);
      onResponse(response(options));
    },
    setURL: (value: string) => {
      url = value;
    },
    run: () => {
      assert.ok(handler);
      return handler();
    },
    advance: (milliseconds: number) => {
      elapsed += milliseconds;
    },
  };
}

await test('a queue-full 503 GET refreshes once with the remaining timeout and resumes', async (context) => {
  const state = harness(context, [{ status: 200, queue: false }]);
  await installQueueRecovery(state.page, BASE_URL, uiRecoveryConfig);
  state.showDocument({});
  await state.run();
  assert.deepEqual(state.waits, [1_000]);
  assert.deepEqual(state.reload.mock.calls[0]?.arguments, [
    { timeout: 14_000, waitUntil: 'domcontentloaded' },
  ]);
  assert.deepEqual(
    state.log.mock.calls.map((call) => call.arguments),
    [['[ui-recovery] GET /products: HTTP 503 queue full; refresh 1/2']],
  );
});

await test('a persistent queue stops clearly after two refreshes without a final wait', async (context) => {
  const state = harness(context, [{}, {}]);
  await installQueueRecovery(state.page, BASE_URL, uiRecoveryConfig);
  state.showDocument({});
  await assert.rejects(state.run(), /Queue-full recovery exhausted.*after 2 refreshes/);
  assert.equal(state.reload.mock.callCount(), 2);
  assert.deepEqual(state.waits, [1_000, 2_000]);
  assert.equal(state.log.mock.callCount(), 2);
});

await test('unsafe methods, redirect origins, routes, statuses, and stale document URLs are refused', async (context) => {
  const state = harness(context);
  await installQueueRecovery(state.page, BASE_URL, uiRecoveryConfig);
  const post = state.response({ method: 'POST', url: `${BASE_URL}/login` }).request();
  for (const document of [
    { status: 200 },
    { method: 'POST' },
    { url: 'https://other.example/products' },
    { url: `${BASE_URL}/delete_account` },
    { url: `${BASE_URL}/logout` },
    { url: `${BASE_URL}/delete_cart/1` },
    { url: `${BASE_URL}/payment` },
    { redirectedFrom: post },
  ]) {
    state.showDocument(document);
    await assert.rejects(state.run(), /Queue-full recovery refused/);
  }
  state.showDocument({});
  state.setURL(`${BASE_URL}/login`);
  await assert.rejects(state.run(), /Queue-full recovery refused/);
  assert.equal(state.reload.mock.callCount(), 0);
  assert.equal(state.log.mock.callCount(), 0);
});

await test('XHR and iframe responses do not replace the current main-document classification', async (context) => {
  const state = harness(context, [{ status: 200, queue: false }]);
  await installQueueRecovery(state.page, BASE_URL, uiRecoveryConfig);
  state.showDocument({});
  state.emit({ status: 200, navigation: false });
  state.emit({ status: 200, mainFrame: false });
  await state.run();
  assert.equal(state.reload.mock.callCount(), 1);
  state.showDocument({ status: 200 });
  state.emit({ navigation: false });
  state.emit({ mainFrame: false });
  await assert.rejects(state.run(), /Queue-full recovery refused/);
  assert.equal(state.reload.mock.callCount(), 1);
});

await test('missing document evidence is refused and a non-queue page is not refreshed', async (context) => {
  const state = harness(context);
  await installQueueRecovery(state.page, BASE_URL, uiRecoveryConfig);
  await assert.rejects(state.run(), /Queue-full recovery refused/);
  state.showDocument({ queue: false });
  await state.run();
  assert.equal(state.reload.mock.callCount(), 0);
  assert.deepEqual(state.waits, []);
});

await test('valid Retry-After delays and fallback delays remain bounded', async (context) => {
  for (const [header, expected] of [
    ['0', 0],
    ['3', 3_000],
    ['Wed, 18 Nov 2026 12:00:04 GMT', 4_000],
    ['nonsense', 1_000],
    ['Wed, 18 Nov 2026 11:59:59 GMT', 1_000],
  ] as const) {
    const state = harness(context, [{ status: 200, queue: false }]);
    await installQueueRecovery(state.page, BASE_URL, uiRecoveryConfig);
    state.showDocument({ headers: { 'retry-after': header } });
    await state.run();
    assert.deepEqual(state.waits, [expected]);
  }
});

await test('Retry-After that consumes the budget fails without an early refresh', async (context) => {
  const state = harness(context);
  await installQueueRecovery(state.page, BASE_URL, uiRecoveryConfig);
  state.showDocument({ headers: { 'retry-after': '15' } });
  await assert.rejects(state.run(), /Queue-full recovery exhausted/);
  assert.equal(state.reload.mock.callCount(), 0);
  assert.deepEqual(state.waits, []);
  assert.equal(state.log.mock.callCount(), 0);
});

await test('backoff overshoot cannot start or announce a refresh past the deadline', async (context) => {
  const state = harness(context);
  await installQueueRecovery(state.page, BASE_URL, uiRecoveryConfig);
  state.showDocument({});
  state.wait.mock.mockImplementation(() => {
    state.advance(15_000);
    return Promise.resolve();
  });
  await assert.rejects(state.run(), /Queue-full recovery exhausted/);
  assert.equal(state.reload.mock.callCount(), 0);
  assert.equal(state.log.mock.callCount(), 0);
});

await test('navigation changing during backoff is rechecked before any refresh', async (context) => {
  const state = harness(context);
  await installQueueRecovery(state.page, BASE_URL, uiRecoveryConfig);
  state.showDocument({});
  state.wait.mock.mockImplementation(() => {
    state.advance(1_000);
    state.showDocument({ method: 'POST' });
    return Promise.resolve();
  });
  await assert.rejects(state.run(), /Queue-full recovery refused/);
  assert.equal(state.reload.mock.callCount(), 0);
  assert.equal(state.log.mock.callCount(), 0);
});

await test('a reload completing after the budget fails even if its queue disappeared', async (context) => {
  const state = harness(context, [{ status: 200, queue: false, durationMs: 14_001 }]);
  await installQueueRecovery(state.page, BASE_URL, uiRecoveryConfig);
  state.showDocument({});
  await assert.rejects(state.run(), /Queue-full recovery exhausted/);
  assert.equal(state.reload.mock.callCount(), 1);
});

await test('reload errors propagate without repeating the operation', async (context) => {
  const state = harness(context);
  const error = new Error('Navigation failed');
  state.reload.mock.mockImplementation(() => Promise.reject(error));
  await installQueueRecovery(state.page, BASE_URL, uiRecoveryConfig);
  state.showDocument({});
  await assert.rejects(state.run(), (caught) => caught === error);
  assert.equal(state.reload.mock.callCount(), 1);
});

await test('the page counter is cumulative but normal test time does not consume recovery time', async (context) => {
  const state = harness(context, [
    { status: 200, queue: false, durationMs: 1_000 },
    { status: 200, queue: false },
  ]);
  await installQueueRecovery(state.page, BASE_URL, uiRecoveryConfig);
  state.showDocument({});
  await state.run();
  state.advance(100_000); // Ordinary business steps between separate queue pages.
  state.showDocument({ url: `${BASE_URL}/view_cart` });
  await state.run();
  assert.equal(state.reload.mock.calls[1]?.arguments[0]?.timeout, 11_000);
  state.showDocument({});
  await assert.rejects(state.run(), /after 2 refreshes/);
  assert.equal(state.reload.mock.callCount(), 2);
  assert.deepEqual(state.waits, [1_000, 2_000]);
});

await test('recovery state is isolated between pages and diagnostics exclude credentials and queries', async (context) => {
  for (let page = 0; page < 2; page++) {
    const state = harness(context, [{ status: 200, queue: false }]);
    await installQueueRecovery(state.page, BASE_URL, uiRecoveryConfig);
    state.showDocument({
      url: `${BASE_URL.replace('https://', 'https://private-user:private-pass@')}/products?email=private-email#private-fragment`,
    });
    await state.run();
    assert.equal(state.reload.mock.callCount(), 1);
    assert.deepEqual(
      state.log.mock.calls.map((call) => call.arguments),
      [['[ui-recovery] GET /products: HTTP 503 queue full; refresh 1/2']],
    );
  }
});
