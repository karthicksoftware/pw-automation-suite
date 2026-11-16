import { test, expect } from '../src/fixtures/test.js';

// The Codex launcher sets AGENT_SEED=1 for the native agent's fixture-aware seed.
test('agent seed opens the catalogue with framework fixtures', async ({ app }) => {
  await app.products.goto();
  await expect(app.products.heading).toBeVisible();
});
