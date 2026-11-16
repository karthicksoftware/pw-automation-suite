# 🤖 AI Usage & Engineering Verification Log (`AI_USAGE.md`)

**Tools Used:** Codex CLI + Playwright Native MCP Agents (`playwright_test_planner`, `playwright_test_generator`, `playwright_test_healer`)  
**Verification Standard:** Every AI contribution was validated using targeted framework unit tests, static AST/type/lint checks (`npm run verify`, covering **39 offline checks**), live application runs, and failure traces.

> [!IMPORTANT]
> **How AI Was Used in This Repository**
> Rather than prompting an LLM to generate unstructured test scripts in one shot, I designed the **layered architecture, fixture contracts, and AST guardrails first**, then used AI agents inside a tight verification loop. Whenever the AI made an incorrect assumption about the application, DOM accessibility tree, or Playwright internals, I caught it through live inspection or static analysis, corrected the root cause, and locked in a regression check. _(Prompts in Section 1 and Section 2 are condensed summaries of the engineering conversation unless marked as exact excerpts.)_

## 📊 Summary of AI Mistakes Caught & Corrected

| #     | Area                    | What the AI Produced (Mistake)                                                | How I Caught It                                                      | Engineering Fix & Permanent Guardrail                                        |
| :---- | :---------------------- | :---------------------------------------------------------------------------- | :------------------------------------------------------------------- | :--------------------------------------------------------------------------- |
| **1** | **Ad Interception**     | Generated UI fixtures with zero handling for Google Vignette popup ads        | Intermittent click/navigation overlays during local UI runs          | Added pre-page `context.route()` aborting ad domains + unit tests            |
| **2** | **Search Semantics**    | Assumed `/api/searchProduct` only matches `product.name`                      | `API-002` & `UI-003` failed on `"Little Girls Mr. Panda Shirt"`      | Matched across `name` + `category.category` and asserted exact UI/API parity |
| **3** | **Accessible Locators** | Used `{ name: 'Add to cart', exact: true }` ignoring FontAwesome icon glyphs  | `UI-002`, `UI-004`, `UI-005` timed out; inspected ARIA snapshot      | Scoped role locators using semantic suffix regexes (`/Add to cart$/`)        |
| **4** | **Agent Seed Init**     | Ran raw `playwright init-agents`, overwriting our custom `tests/seed.spec.ts` | `npm run typecheck` and `check:architecture` failed immediately      | Built `scripts/init-agents.mjs` to pass `--project=ui` and restore the seed  |
| **5** | **Agent Test Gen**      | `playwright_test_generator` used a ternary expression inside a test body      | Rejected automatically by ESLint `playwright/no-conditional-in-test` | Corrected conditional; verified `playwright_test_healer` on injected fault   |

## 🛠️ 1. Prompts & Iterative Architecture Workflow

### Phase A — Initial Architecture & Guardrail Generation

- **Prompt Summary:**
  > _"Build an enterprise-level, scalable, agentic-AI driven, GitHub Actions integrated, Page Object Model based Playwright automation framework in strict TypeScript for `https://automationexercise.com`. We have a default `--init-agents` from Playwright right, we can use that—loop the Codex (`playwright init-agents --loop=codex`). Enforce strict layer boundaries so tests only consume typed fixtures (`app`, `api`, `userDraft`, `account`, `authenticatedApp`) and never construct raw locators or share mutable account state."_
- **What AI Generated:**
  - Scaffolded `src/domain`, `src/data`, `src/api`, `src/pages`, `src/assertions`, `src/fixtures`, the 9 core scenarios (`UI-001`–`UI-005`, `API-001`–`API-004`), `check-architecture.ts`, and `.codex/` agent definitions.
- **Engineering Pruning Prompt (Removing Over-Engineering):**
  > _"Simplify the framework: remove the custom CLI launcher wrapper, custom mandatory-scenario JSON registry, and extra scaffolding files so standard Playwright CLI commands (`npx playwright test`) work directly, while keeping `node_modules` ignored in `.gitignore` and preserving all AST architecture rules, fixtures, and the 9 critical scenarios."_

### Phase B — Consolidating & Refactoring Account Lifecycle Fixtures

- **Prompt Summaries:**
  1. _"Move `check-architecture.ts` and `files.ts` beside the architecture tests under `tests/framework/architecture/` and retain only `scripts/init-agents.mjs` in `scripts/`."_
  2. _"Can we move `account-lifecycle.ts` implementation directly into `src/fixtures/test.ts`? The nested error handling in `userDraftFixture` isn't readable—split it into smaller private functions in the same file, replace the `Pick<>` aliases with explicit interfaces, and update the framework unit tests."_

## 🔍 2. Deep-Dive: 5 Concrete Examples Where the AI Was Wrong & How I Caught It

### 🔴 Case 1: AI Missed Intermittent Google Vignette Ad Overlays

> [!WARNING]
> **What Went Wrong:** The initial AI-generated framework omitted handling for third-party Google advertising traffic. I observed intermittent ad overlays during local UI execution and flagged the omission (a subsequent diagnostic probe confirmed live `googlesyndication.com` and `doubleclick.net` ad requests on catalogue/search pages without independently reproducing the click failure).

- **How I Caught It:** While running the UI suite locally, I observed random Google ad overlays appearing on page loads and clicks during product navigation and checkout transitions.
- **Correction Prompt Summary:**
  > _"Earlier AI exploration and test generation did not account for Google ads appearing on page loads or clicks, causing intermittent failures. Instead of DOM/iframe-specific locator handlers, abort the observed Google advertising hosts at the `context` fixture level before page creation, block service workers from bypassing routing, and add offline unit tests for domain boundaries."_

```diff
// src/fixtures/test.ts
+const GOOGLE_AD_DOMAINS = ['doubleclick.net', 'googlesyndication.com'];
+
+/** Match advertising hosts only, never a domain mentioned in an application URL or query. */
+export function isGoogleAdUrl(url: URL): boolean {
+  return GOOGLE_AD_DOMAINS.some(
+    (domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`),
+  );
+}

 export const test = base.extend<FrameworkFixtures>({
+  context: async ({ context }, use) => {
+    // Install before the page fixture creates a page; includes iframe and popup traffic.
+    await context.route(isGoogleAdUrl, (route) => route.abort('blockedbyclient'));
+    await use(context);
+  },
```

- **Verification:** Added 3 unit tests in `tests/framework/ad-blocking.test.ts` verifying that `doubleclick.net` and `googlesyndication.com` (and subdomains) are blocked while `automationexercise.com`, `fonts.googleapis.com`, and deceptive URLs (`https://doubleclick.net.example.com/`) pass through untouched.

### 🔴 Case 2: AI Assumed Product Search Only Matched Product Names (`API-002` & `UI-003`)

> [!WARNING]
> **What Went Wrong:** When writing `API-002` (`POST /api/searchProduct` with `search_product=top`), the AI assumed every returned product would contain the substring `"top"` in `product.name`.

```ts
// ❌ Incorrect AI-Generated Assertion (Failed in Live Execution)
expect(result.body.products.every((product) => product.name.toLowerCase().includes('top'))).toBe(
  true,
);
```

- **How I Caught It:** The first test run failed `API-002` and `UI-003` with `Expected: true; Received: false`. Inspecting the live JSON payload from `/api/searchProduct` revealed products like `"Little Girls Mr. Panda Shirt"` and `"Colour Blocked Shirt – Sky Blue"`—which matched because their **category** is `"Tops & Shirts"`.
- **Engineering Fix:** Instead of weakening the assertion to `.toBeGreaterThan(0)`, I updated `API-002` to compute the exact expected product ID list from the full catalogue matching either `product.name` or `product.category.category`, and updated `UI-003` to assert 1:1 parity between rendered UI product names and the validated API search result:

```ts
// ✅ Corrected Implementation in tests/api/catalog.spec.ts
const expectedIds = catalogue.body.products
  .filter((product) =>
    [product.name, product.category.category].some((value) => value.toLowerCase().includes('top')),
  )
  .map((product) => product.id)
  .sort((left, right) => left - right);

expect(
  result.body.products.map((product) => product.id).sort((left, right) => left - right),
).toEqual(expectedIds);
```

### 🔴 Case 3: AI Used `exact: true` on Accessible Names Containing Icon Glyphs

> [!WARNING]
> **What Went Wrong:** The AI wrote strict exact-match role locators for buttons and navigation links that actually contain prepended FontAwesome Unicode glyphs in the DOM accessibility tree.

```diff
// src/pages/product-details-page.ts & src/pages/components/header.ts
-await this.page.getByRole('button', { name: 'Add to cart', exact: true }).click();
-this.logoutLink = this.root.getByRole('link', { name: 'Logout', exact: true });
+await this.page.getByRole('button', { name: /Add to cart$/ }).click();
+this.logoutLink = this.root.getByRole('link', { name: /Logout$/ });
```

- **How I Caught It:** `UI-002` (Logout), `UI-004` (Cart), and `UI-005` (Checkout) timed out. Inspecting Playwright's accessibility snapshot showed accessible names like `" Add to cart"` and `" Logout"`.
- **Engineering Fix:** Replaced `exact: true` with suffix regular expressions (`/Add to cart$/`, `/Logout$/`, `/Signup \/ Login$/`, `/View Product$/`) inside the owning Page Objects—preserving semantic role locators without using brittle CSS classes or `{ force: true }`.

### 🔴 Case 4: Native `playwright init-agents` Overwrote Our Custom Fixture Seed

> [!WARNING]
> **What Went Wrong:** The AI initially configured `"agents:init": "playwright init-agents --loop=codex"` directly in `package.json`. Running it selected the first project (`api`) and **overwrote `tests/seed.spec.ts`** with raw `@playwright/test` boilerplate, immediately breaking `npm run typecheck` and `npm run check:architecture`.

- **Engineering Fix:** Built `scripts/init-agents.mjs` to explicitly target `--project=ui` and restore our fixture-aware `tests/seed.spec.ts` in a `finally` block:

```ts
// scripts/init-agents.mjs — Preserves fixture contract across agent regenerations
const seedPath = new URL('../tests/seed.spec.ts', import.meta.url);
const seed = readFileSync(seedPath, 'utf8');
const cli = fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url));
let result;
try {
  result = spawnSync(
    process.execPath,
    [cli, 'init-agents', '--loop=codex', '--project=ui', ...process.argv.slice(2)],
    { stdio: 'inherit' },
  );
} finally {
  // Playwright rewrites seed.spec.ts even when it exists. Preserve our fixture contract.
  writeFileSync(seedPath, seed);
}
```

### 🔴 Case 5: Native Agent Generator Caught by ESLint (`playwright/no-conditional-in-test`)

- **Exact Generation Prompt Excerpt (`playwright_test_planner` → `playwright_test_generator`):**
  > _"Provision and delete the synthetic account through the existing `account` fixture; use `app.auth.goto()`, `app.auth.login()`, `app.auth.loginError`, and `app.header.loggedInUser`. Assert the specific login error is visible, the login form remains visible, and no customer is logged in."_
- **What the AI Generator Produced:** The generator used a conditional ternary operator inside the test to derive an invalid password, which `npm run verify` immediately rejected via ESLint's `playwright/no-conditional-in-test` rule (`--max-warnings=0`).
- **Separate Controlled Healer Exercise (Historical):** After the generator's conditional expression was rejected and corrected, we deliberately supplied the actual account password as the wrong-password input so authentication succeeded and failed the login-error assertion. We then exercised `playwright_test_healer` on that injected fault (the optional demo file was later removed during repository simplification).
- **Exact Healer Prompt Excerpt:**
  > _"Repair only the password derivation in this test so the submitted value is nonempty and unconditionally different from `account.password`. Preserve all existing business assertions and fixtures. Do not introduce a conditional, weaken an assertion, skip a test, mark expected failure, or edit any other file."_
- **Healer Fix:** The healer agent ran `test_run` and `test_debug`, inspected the snapshot, and repaired the password derivation using deterministic string concatenation:

```ts
// ✅ Deterministic wrong-password derivation (passes ESLint & architecture checks)
const wrongPassword = `${account.password}WrongPassword006!`;
```
