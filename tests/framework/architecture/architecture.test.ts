import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ESLint } from 'eslint';
import { analyzeSource } from './check-architecture.js';

const entrypoint = "import { test, expect } from '../../src/fixtures/fixtures.js';\n";
const file = 'tests/ui/example.spec.ts';

await test('accepts fixture-based tests and selector ownership inside a page object', () => {
  assert.deepEqual(
    analyzeSource(
      file,
      `${entrypoint}test('UI-010 observes catalogue', async ({ app }) => { await app.products.goto(); await expect(app.products.heading).toBeVisible(); });`,
    ),
    [],
  );
  assert.deepEqual(
    analyzeSource(
      'src/pages/example-page.ts',
      "import type { Page } from '@playwright/test'; export const heading = (page: Page) => page.getByRole('heading');",
    ),
    [],
  );
});

for (const [name, body, rule] of [
  [
    'raw imports',
    "import { test, expect } from '@playwright/test'; test('bad', async ({ page }) => { await expect(page).toHaveTitle('x'); });",
    'fixture-import',
  ],
  [
    'selectors through aliases',
    `${entrypoint}test('bad', async ({ page: browserPage }) => { await expect(browserPage.getByRole('button')).toBeVisible(); });`,
    'page-object-selectors',
  ],
  [
    'raw request fixtures',
    `${entrypoint}test('bad', async ({ request: http, api }) => { await http.get('/'); expect(api).toBeDefined(); });`,
    'fixture-capabilities',
  ],
  [
    'focused tests',
    `${entrypoint}test.only('bad', async ({ app }) => { expect(app).toBeDefined(); });`,
    'no-disabled-tests',
  ],
  [
    'nested skipped tests',
    `${entrypoint}test.describe.skip('bad', () => {});`,
    'no-disabled-tests',
  ],
  ['expected failure annotations', `${entrypoint}test.fail();`, 'no-disabled-tests'],
  [
    'fixed waits',
    `${entrypoint}test('bad', async ({ app }) => { await app.products.waitForTimeout(1000); expect(app).toBeDefined(); });`,
    'no-sleep',
  ],
  [
    'forced actions',
    `${entrypoint}test('bad', async ({ app }) => { await app.products.heading.click({ force: true }); expect(app).toBeDefined(); });`,
    'no-force',
  ],
  [
    'empty assertions',
    `${entrypoint}test('bad', async ({ app }) => { await app.products.goto(); });`,
    'meaningful-assertion',
  ],
  [
    'constant assertions',
    `${entrypoint}test('bad', async ({ app }) => { await app.products.goto(); expect(true).toBe(true); });`,
    'meaningful-assertion',
  ],
  [
    'state injection',
    `${entrypoint}test('bad', async ({ app }) => { await app.products.evaluate(() => {}); expect(app).toBeDefined(); });`,
    'no-state-injection',
  ],
] as const) {
  await test(`rejects ${name}`, () => {
    assert.ok(analyzeSource(file, body).some((violation) => violation.rule === rule));
  });
}

await test('enforces dependency direction for pages, API clients, domain, and tests', () => {
  for (const [path, source] of [
    ['src/pages/bad.ts', "import '../../tests/ui/cart.spec.js';"],
    ['src/api/bad.ts', "import '../pages/cart-page.js';"],
    ['src/api/bad.ts', "import '../../tests/framework/architecture/check-architecture.js';"],
    ['src/domain/bad.ts', "import '../fixtures/fixtures.js';"],
    ['src/assertions/bad.ts', "import '../fixtures/fixtures.js';"],
    ['src/api/bad.ts', "import '../assertions/api-expect.js';"],
    ['src/pages/bad.ts', "import '../assertions/cart.js';"],
    [file, `${entrypoint}import '../../src/api/accounts-client.js';`],
  ]) {
    assert.ok(path && source);
    assert.ok(analyzeSource(path, source).some((violation) => violation.rule === 'layer-boundary'));
  }
  for (const [source, rule] of [
    ["page.getByRole('heading');", 'page-object-selectors'],
    ['row.root.click({ force: true });', 'no-force'],
    ['page.route(() => {});', 'no-state-injection'],
  ]) {
    assert.ok(source && rule);
    assert.ok(
      analyzeSource('src/assertions/bad.ts', source).some((violation) => violation.rule === rule),
    );
  }
});

await test('shared assertion helpers are supported through the fixture entrypoint', async () => {
  const source =
    "import { test, expectCartLine } from '../../src/fixtures/fixtures.js';\n\n" +
    "test('UI-010 checks a cart line', async ({ app }) => { await expectCartLine(app.cart.product(1), { name: 'Top', quantity: 2, totalPaise: 100000 }); });";
  assert.deepEqual(analyzeSource(file, source), []);
  const lint = new ESLint();
  const [result] = await lint.lintText(source, { filePath: 'tests/ui/cart.spec.ts' });
  assert.equal(result?.errorCount, 0);
  assert.equal(result?.warningCount, 0);
});

await test('permits test timeout budgets and filesystem cleanup options', () => {
  assert.deepEqual(
    analyzeSource(
      file,
      `${entrypoint}test('UI-010 has a budget', async ({ app }) => { test.setTimeout(120000); await expect(app.products.heading).toBeVisible(); });`,
    ),
    [],
  );
  assert.deepEqual(
    analyzeSource(
      'tests/framework/cleanup.test.ts',
      'rmSync(directory, { recursive: true, force: true });',
    ),
    [],
  );
});

await test('type-aware lint rejects an unawaited page-object operation', async () => {
  const lint = new ESLint();
  const [invalid] = await lint.lintText(
    `${entrypoint}test('UI-010 invalid async operation', async ({ app }) => { app.products.goto(); await expect(app.products.heading).toBeVisible(); });`,
    { filePath: 'tests/ui/cart.spec.ts' },
  );
  assert.ok(
    invalid?.messages.some(
      (message) => message.ruleId === '@typescript-eslint/no-floating-promises',
    ),
  );
  const [discarded] = await lint.lintText(
    `${entrypoint}test('UI-010 discarded operation', async ({ app }) => { void app.products.goto(); await expect(app.products.heading).toBeVisible(); });`,
    { filePath: 'tests/ui/cart.spec.ts' },
  );
  assert.ok(
    discarded?.messages.some(
      (message) => message.ruleId === '@typescript-eslint/no-floating-promises',
    ),
  );
  const [valid] = await lint.lintText(
    `${entrypoint}test('UI-010 valid async operation', async ({ app }) => { await app.products.goto(); await expect(app.products.heading).toBeVisible(); });`,
    { filePath: 'tests/ui/cart.spec.ts' },
  );
  assert.equal(valid?.errorCount, 0);
});
