# 🏛️ Architecture Decisions (`DECISIONS.md`)

**System Under Test:** [Automation Exercise](https://automationexercise.com)

**Stack:** Playwright `1.65` · TypeScript `5.9` (Strict ESM) · Zod `4.6` · Node.js `24 LTS` · Codex MCP Agents

> [!IMPORTANT]
> **Design Philosophy — Agentic-First by Construction, Not Just Documentation**
> When an AI coding agent (Claude Code, Codex, Copilot) contributes a test, factory, or page object, prose instructions alone are not enough—models frequently fall back to training-data habits (`page.locator()` in specs, `waitForTimeout()`, or `test.fixme()`). Every architectural decision below pairs a **narrow, typed TypeScript surface** with **automated AST and ESLint enforcement (`npm run verify`)** so invalid agent contributions fail in fast local feedback loops.

## 📊 Executive Summary — Architecture Decision Matrix

| #     | Architecture Decision                    | What We Chose                                                                | What We Rejected                                              | Constraint That Would Flip Decision                                       |
| :---- | :--------------------------------------- | :--------------------------------------------------------------------------- | :------------------------------------------------------------ | :------------------------------------------------------------------------ |
| **1** | **UI Abstraction & Entrypoint**          | Single `src/fixtures/fixtures.ts` entrypoint + composed `Application` POM    | Inheritance `BasePage`, action wrappers, raw spec selectors   | Multi-app shared design system needing a versioned component package      |
| **2** | **Auth & Test Data Isolation**           | Per-test synthetic users (`userDraft` / `account`) + API setup + UI auth     | Shared global account, committed `.env` users, shared cookies | Slow/rate-limited account creation + deterministic backend cart-reset API |
| **3** | **API Contracts & Currency Math**        | Dual HTTP/business `responseCode` matcher + Zod + integer-paise math         | Trusting `HTTP 200`, `Content-Type` headers, or `as` casts    | Standard REST status semantics backed by an authoritative OpenAPI schema  |
| **4** | **Third-Party Ad Resilience**            | Pre-page `context.route()` aborting ad hosts (`blockedbyclient`)             | Fragile DOM `addLocatorHandler()` or broad `*.google.com`     | Testing ad-tech rendering, CMP consent flows, or service-worker caching   |
| **5** | **Agentic Guardrails & CI Quality Gate** | TypeScript AST rule checker + Codex MCP seed loop + 3-job GitHub Actions     | Prose-only agent docs, LLM auto-healing inside CI pipelines   | Suite scaling past 50+ UI tests requiring matrix sharding (`--shard=x/y`) |
| **6** | **Queue-Full Page Recovery**             | Central locator handler with verified 503 GET recovery and bounded refreshes | Unconditional refreshes, form replay, per-test recovery loops | Recovery needed during navigation rather than before actions/assertions   |

## 🧩 Layered Architecture & Dependency Flow

| Layer                  | Path                                   | Allowed Imports (`check-architecture.ts`)                | Core Responsibility                                                       |
| :--------------------- | :------------------------------------- | :------------------------------------------------------- | :------------------------------------------------------------------------ |
| **Test Specs**         | `tests/ui/*.spec.ts`, `tests/api/*.ts` | `src/fixtures`, `src/domain`, `src/data`                 | Business journey orchestration and explicit scenario assertions           |
| **Fixtures**           | `src/fixtures/fixtures.ts`             | `api`, `pages`, `data`, `domain`, `config`, `assertions` | Dependency injection, context ad-blocking, account provisioning & cleanup |
| **Shared Assertions**  | `src/assertions/*.ts`                  | `src/assertions`, `src/pages`, `src/domain`              | Custom `toHaveApiOutcome` matcher and polled `expectCartLine` helper      |
| **Page Objects (POM)** | `src/pages/**/*.ts`                    | `src/pages`, `src/domain`                                | Scoped Playwright `Locator` ownership and assertion-free UI interactions  |
| **API Clients**        | `src/api/*.ts`                         | `src/api`, `src/config`, `src/domain`                    | Form-encoded transport calls and runtime Zod response parsing             |
| **Factories & Domain** | `src/data/*.ts`, `src/domain/*.ts`     | `src/domain`, `src/data`                                 | Synthetic user/payment generation, Zod schemas, integer-paise arithmetic  |
| **AST & Unit Checks**  | `tests/framework/**/*.ts`              | Node `node:test` runner + TypeScript compiler AST        | 75 offline checks verifying boundaries, teardown, ad filters, and math    |

## 1. Composed Page Objects with a Single Typed Fixture Entrypoint

### ✅ What I Chose

- **Single Fixture Import Surface**: Every application spec imports `test`, `expect`, and `expectCartLine` exclusively from `src/fixtures/fixtures.ts`.
- **Composition Over Inheritance (`src/pages/application.ts`)**: Focused Page Objects (`AuthPage`, `RegistrationPage`, `ProductsPage`, `ProductDetailsPage`, `CartPage`, `CheckoutPage`, `PaymentPage`) and scoped UI components (`Header`, `CartModal`, `ProductCard`, `CartRow`) are composed into a single `Application` root injected via the `app` and `authenticatedApp` fixtures.
- **Scoped Component `Locator` Roots**: Repeating UI elements (catalogue cards and cart rows) receive a scoped `Locator` root in their constructor so child queries never trigger Playwright strict-mode collisions.
- **AST-Enforced Boundaries**: `tests/framework/architecture/check-architecture.ts` inspects the TypeScript AST to reject raw `@playwright/test` imports, selector construction inside specs, and raw `page`/`context`/`request` fixture usage.

```ts
// src/pages/application.ts — Composition root (no BasePage inheritance)
export class Application {
  readonly auth: AuthPage;
  readonly registration: RegistrationPage;
  readonly products: ProductsPage;
  readonly productDetails: ProductDetailsPage;
  readonly cart: CartPage;
  readonly checkout: CheckoutPage;
  readonly payment: PaymentPage;
  readonly header: Header;
  readonly cartModal: CartModal;

  constructor(page: Page) {
    this.auth = new AuthPage(page);
    this.registration = new RegistrationPage(page);
    this.products = new ProductsPage(page);
    this.productDetails = new ProductDetailsPage(page);
    this.cart = new CartPage(page);
    this.checkout = new CheckoutPage(page);
    this.payment = new PaymentPage(page);
    this.header = new Header(page);
    this.cartModal = new CartModal(page);
  }
}
```

```ts
// src/pages/cart-page.ts — Scoped Locator component reused across Cart & Checkout
export class CartRow {
  readonly name;
  readonly unitPrice;
  readonly quantity;
  readonly total;

  constructor(readonly root: Locator) {
    this.name = root.locator('.cart_description h4 a');
    this.unitPrice = root.locator('.cart_price p');
    this.quantity = root.locator('.cart_quantity button');
    this.total = root.locator('.cart_total_price');
  }

  async remove() {
    await this.root.locator('.cart_quantity_delete').click();
  }
}
```

### ❌ What I Rejected and Why

- **Monolithic `BasePage` Classes & Action Wrappers (`clickElement`, `fillText`)**: Wrapping native Playwright methods hides Playwright's built-in actionability checks, bloats stack traces, and forces AI coding agents to learn a custom driver API instead of standard Playwright `Locator` semantics.
- **Selectors Inside `.spec.ts` Files**: Allowing raw `page.getByRole()` or `page.locator()` in test files causes immediate selector drift when an AI agent generates new scenarios.

### 🔄 What Constraint Would Flip the Decision

> [!NOTE]
> **Flip Trigger:** If we scaled across **multiple web applications sharing a versioned corporate design system**, I would extract shared UI widgets (`Header`, `Modal`, `DataTable`) into a versioned internal package (`@org/playwright-ui-components`). Even then, I would retain composition over `BasePage` inheritance.

## 2. Per-Test Isolated Accounts, API Provisioning, and Real UI Authentication

### ✅ What I Chose

- **Zero Shared Mutable Accounts**: Every mutating test generates a unique synthetic identity (`createUser(runId, workerIndex, retry)` in `src/data/user-factory.ts`). Dynamic product resolution (`product` fixture) likewise selects the first live catalogue item without relying on a hardcoded product name or magic ID.
- **Pre-Registered Teardown Boundary (`userDraftFixture`)**: Cleanup is registered in a `finally` block _before_ account creation or UI signup begins, so teardown still attempts deletion after provisioning or assertions fail mid-test.
- **Native Failure Reporting**: Account deletion errors propagate from fixture teardown to Playwright. A cleanup error fails an otherwise passing test; when the test also fails, Playwright records both errors. A runner-level offline regression verifies this behavior using the actual framework fixtures, including failed provisioning. Custom cleanup attachments, status-based suppression, and error aggregation are unnecessary.
- **Fast API Setup + Real UI Login**: Prerequisite accounts are created via `POST /api/createAccount` (`account` fixture), while `authenticatedApp` performs real browser login through `/login`.

```ts
// src/fixtures/fixtures.ts — Owned-account teardown with native failure reporting
export async function userDraftFixture(
  { api }: { api: { accounts: AccountCleanupClient } },
  use: (user: UserDraft) => Promise<void>,
  testInfo: AccountFixtureInfo,
): Promise<void> {
  const user = createUser(environment.runId, testInfo.workerIndex, testInfo.retry);
  try {
    await use(user);
  } finally {
    await cleanupOwnedAccount(api.accounts, user);
  }
}
```

### ❌ What I Rejected and Why

- **Global Shared Accounts or Committed Credentials**: `automationexercise.com` persists shopping carts server-side per account. Sharing one account across parallel workers or retries causes race conditions where Worker A empties the cart while Worker B is asserting checkout totals.
- **Shared `storageState` Session Files Across Mutating Tests**: Reusing cookies across parallel cart/checkout specs shares the same server-side session state. Additionally, `POST /api/verifyLogin` only validates credentials in JSON and does not set browser session cookies.
- **Custom Cleanup Error Reporting**: Attachments, status guards, and nested reporting-error handling duplicated the runner's error reporting. Cleanup now throws naturally, while a runner-level regression checks the original and teardown errors remain visible.

### 🔄 What Constraint Would Flip the Decision

> [!NOTE]
> **Flip Trigger:** If **user provisioning became a measured bottleneck** (e.g., slow enterprise IAM/SSO provisioning) and the backend offered a **deterministic state-reset endpoint** (`POST /api/test/reset-account`), I would move to a **worker-scoped account pool (`scope: 'worker'`)** with cached `storageState` per worker and an explicit pre-test state reset.

## 3. Dual-Layer API Validation (HTTP Transport vs. Business `responseCode`) and Integer-Paise Math

### ✅ What I Chose

- **Decoupled HTTP & Business Status (`src/api/read-response.ts`)**: `automationexercise.com` returns `Content-Type: text/html` for JSON endpoints and wraps business status codes (`200`, `201`, `404`, `405`) inside an `HTTP 200` body. Our clients validate HTTP transport first, then parse the payload through **Zod schemas (`src/domain/contracts.ts`)**.
- **Custom Playwright Matcher (`toHaveApiOutcome`)**: Extends Playwright's `expect` so tests verify both layers declaratively while redacting sensitive fields (like user passwords) from failure diffs.
- **Bounded HTTP 503 Recovery (`src/api/retry-request.ts`)**: Read-only requests and opt-in fixture cleanup use three total attempts, 1s/2s fallback backoff, a 15s monotonic transport deadline, and bounded `Retry-After` handling before response parsing. Creation and explicit deletion remain single-shot, preserving their exact API contract assertions. Clients pass the request context, endpoint, and ordinary Playwright options to a callback-free helper using `request.fetch()`. Each retry prints one sanitized method/path console line; there are no observers, history collections, or retry report attachments.
- **Integer-Paise Currency Math (`src/domain/money.ts`)**: Converts display prices (`"Rs. 1,234.50"`) into integer paise (`123_450`) before multiplication or comparison.

```ts
// tests/api/accounts.spec.ts — Declarative dual-layer API assertion
const created = await api.accounts.create(userDraft);
expect(created).toHaveApiOutcome({
  httpStatus: 200,
  responseCode: 201,
  message: 'User created!',
});
```

```ts
// src/domain/money.ts — Exact integer-paise conversion (no floating-point drift)
export function rupeesToPaise(text: string): number {
  const match = /^Rs\.\s*(\d+|\d{1,3}(?:,\d{3})+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match?.[1]) throw new Error(`Unsupported rupee amount: ${text}`);
  const whole = Number(match[1].replaceAll(',', ''));
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  const value = whole * 100 + fraction;
  if (!Number.isSafeInteger(value)) throw new Error('Rupee amount exceeds safe integer precision');
  return value;
}
```

### ❌ What I Rejected and Why

- **Checking `expect(response.ok()).toBeTruthy()` Alone**: A `404 User not found!` or `405 Method not supported` from this backend still arrives with `HTTP 200 OK`, causing naive status checks to pass silently on broken flows.
- **Blanket Retries for Every 5xx or Mutation**: These can conceal permanent failures and repeat an operation the server already applied. Retry only the observed 503 status on reviewed repeatable operations; leave schema, business, and assertion failures intact. A short console message identifies each retried request without logging credentials, payloads, or URL queries.
- **Compile-Time Type Casts (`await response.json() as ProductList`)**: TypeScript types vanish at runtime; Zod catches schema drift immediately at the API boundary.

### 🔄 What Constraint Would Flip the Decision

> [!NOTE]
> **Flip Trigger:** If the backend adopted **standard HTTP status codes governed by an OpenAPI 3.1 contract**, I would generate typed API clients directly from the OpenAPI spec and assert standard HTTP status codes, keeping Zod only at untrusted external boundaries.

## 4. Context-Level Third-Party Ad Blocking (`blockedbyclient`) Over DOM Locator Handlers

### ✅ What I Chose

- **Pre-Page Context Routing (`src/fixtures/fixtures.ts`)**: The `context` fixture registers a hostname-checked route interceptor _before_ any `Page` is created, aborting requests to `doubleclick.net`, `googlesyndication.com`, and their subdomains with `'blockedbyclient'`.
- **Service Worker Blocking (`playwright.config.ts`)**: Configured `serviceWorkers: 'block'` so third-party scripts cannot bypass context routing.
- **Zero Application Mocking**: All `automationexercise.com` endpoints and unrelated Google assets (`fonts.googleapis.com`, `fonts.gstatic.com`) remain 100% live, verified by unit tests in `tests/framework/ad-blocking.test.ts`.

```ts
// src/fixtures/fixtures.ts — Strict hostname matching + pre-page context interception
const GOOGLE_AD_DOMAINS = ['doubleclick.net', 'googlesyndication.com'];

export function isGoogleAdUrl(url: URL): boolean {
  return GOOGLE_AD_DOMAINS.some(
    (domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`),
  );
}

// Registered inside test = base.extend<FrameworkFixtures>({ ... })
context: async ({ context }, use) => {
  await context.route(isGoogleAdUrl, (route) => route.abort('blockedbyclient'));
  await use(context);
},
```

### ❌ What I Rejected and Why

- **Reactive DOM Dismissal (`page.addLocatorHandler()`)**: Google AdSense vignette overlays render inside dynamically nested cross-origin iframes (`#aswift_*`, `#ad_iframe`) whose close-button selectors mutate frequently. Waiting for the overlay DOM to appear wastes bandwidth and still causes flaky click interception timeouts.
- **Per-Test `page.route()` Calls**: Placing route interception inside specs violates layer boundaries and misses initial popup/iframe requests.

### 🔄 What Constraint Would Flip the Decision

> [!NOTE]
> **Flip Trigger:** If **ad-slot rendering, consent management (CMP) banners, or service-worker offline behavior** became part of the product scope under test, I would parameterize the ad filter via a fixture option (`blockThirdPartyAds: boolean`, defaulting to `true` for commerce flows and `false` for ad/CMP specs).

## 5. Executable Agentic Guardrails and Scoped CI/CD Quality Gate

### ✅ What I Chose

- **AST & Type-Aware Lint Guardrails (`npm run verify`)**: Combines Prettier, `tsc --noEmit`, `eslint` (`@typescript-eslint/no-floating-promises`, `playwright/no-conditional-in-test`), `check-architecture.ts`, and 75 offline framework unit tests into a single fast command.
- **Seed-Preserving Native Agent Loop (`scripts/init-agents.mjs`, `.codex/`)**: Configures Playwright's native `planner`, `generator`, and `healer` agents for the Codex loop while preserving our fixture-aware `tests/seed.spec.ts` (`AGENT_SEED=1`).
- **Deterministic 3-Job GitHub Actions Workflow (`.github/workflows/playwright.yml`)**: Although CI/CD is listed as out-of-scope in the prompt (with instructions to document it here if included), I added a minimal, production-grade pipeline:
  1. `quality` job (`npm run verify` — runs in seconds without installing browsers).
  2. `api` job (`npm run test:api` — no browser binaries; bounded request recovery plus one whole-test CI retry with a fresh account identity per attempt; flaky outcomes still fail CI).
  3. `ui` job (`npm run test:ui` — runs Chromium journeys with `failOnFlakyTests: true` and 7-day trace/HTML artifact uploads).

```ts
// tests/framework/architecture/check-architecture.ts — Examples of AST rules enforced by npm run verify and CI
// 1. Reject raw @playwright/test value imports in specs:
//    'Application tests must import test/expect from src/fixtures/fixtures.js.'
// 2. Reject selector construction (locator, getByRole, getByTestId, etc.) in specs:
//    'Construct selectors inside page objects/components.'
// 3. Reject fixed waits (waitForTimeout, setTimeout) and forced actions ({ force: true }):
//    'Use web-first assertions or an observable application event.'
// 4. Reject skipped/focused tests (test.only, test.skip, test.fixme, test.fail):
//    'Focused, skipped, and expected-failure tests cannot satisfy coverage.'
```

### ❌ What I Rejected and Why

- **Autonomous AI Auto-Healing Inside CI**: Running an LLM healer inside GitHub Actions introduces non-determinism, external API key risk, and the danger of an agent silently weakening an assertion to make CI green. AI agents belong in the interactive authoring loop; CI must remain strictly deterministic.
- **Heavy Multi-Browser / Sharded CI Matrices for 9 Tests**: Adding Firefox/WebKit matrices and multi-machine sharding for a 9-test suite adds CI queue overhead without proportional signal.

### 🔄 What Constraint Would Flip the Decision

> [!NOTE]
> **Flip Trigger:** Once the suite scales past **50+ UI scenarios** or gates multi-browser production releases, I would enable native Playwright CI sharding (`--shard=1/4` across matrix runners) and add WebKit/Mobile Safari projects on release branches.

## 6. Bounded Queue-Full Page Recovery (`page.addLocatorHandler`)

During UI execution, I observed `GET /products` returning HTTP 503 and displaying **"This website is under heavy load (queue full)"** instead of the storefront. Expected application controls disappeared, causing intermittent test failures. Backend API retries did not cover this browser document request.

### ✅ What I Chose

- **Central Page Handler (`src/pages/queue-full-page.ts`)**: Install one `page.addLocatorHandler()` through the page fixture before use. Recovery requires both the exact queue heading and a matching HTTP 503 main document on a reviewed same-origin read-only GET route.
- **Refresh the Current Page**: Use `page.reload()` to preserve the current path and query. `baseURL` establishes the trusted origin; it is not a recovery destination. Business assertions continue after recovery.
- **Bounded Recovery (`src/config/ui-recovery.ts`)**: Allow **two refreshes per page/test** and **15 seconds of cumulative recovery time**, with 1s/2s fallback delays and valid `Retry-After` handling. Each refresh logs a sanitized method/path message. Persistent queues fail clearly with native screenshots, traces, and account cleanup.

```ts
// src/fixtures/fixtures.ts — Recovery installed once before page use
page: async ({ page }, use) => {
  await installQueueRecovery(page, environment.baseURL, uiRecoveryConfig);
  await use(page);
},
```

### ❌ What I Rejected and Why

- **Unconditional Refreshes**: Arbitrary 503 responses do not prove the main document is the observed queue page. POST submissions, POST-origin redirects, mutating GETs, unknown routes, and iframe/XHR errors are excluded to avoid repeating mutations or hiding unrelated failures.
- **Per-Test Recovery Loops**: Repeating refresh logic in specs or page objects adds boilerplate and inconsistent limits. The fixture installs the same recovery behavior for every UI test and the agent seed.

### 🔄 What Constraint Would Flip the Decision

> [!NOTE]
> **Flip Trigger:** If recovery must happen during navigation rather than before an action or auto-waiting assertion, I would introduce an explicit navigation helper with the same safety checks and limits. The locator handler cannot rescue an already timed-out navigation.
