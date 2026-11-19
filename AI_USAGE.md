# 🤖 AI Usage & Engineering Verification Log (`AI_USAGE.md`)

**Tools Used:** Codex CLI + Playwright Native MCP Agents (`playwright_test_planner`, `playwright_test_generator`, `playwright_test_healer`)  
**Verification Standard:** Every AI contribution was validated using targeted framework unit tests, static AST/type/lint checks (`npm run verify`, covering **62 offline checks**), live application runs, and failure traces.

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

## Bounded API 503 recovery — 18 November 2026

**User request:** After observing HTTP 503 failures on initial CI attempts, the user asked the native Playwright planner to evaluate request-level retries, then instructed the native Playwright generator: "go ahead and impl this plan."

The planner evaluated operation replay safety, deadlines, Retry-After, exact mutation assertions, diagnostics, and Playwright's ECONNRESET-only native retry option. Its ignored evaluation artifact was supplied to the generator. The generator owned the shared retry transport, account/catalogue integrations, and offline retry tests; the parent owned fixture integration, documentation, policy guidance, and final validation. No new UI selectors or production fault injection were needed.

Implemented HTTP 503-only recovery for read-only operations and explicitly opted fixture deletion cleanup into recovery. Three total attempts, 1s/2s fallback backoff, valid Retry-After handling, and a 15s monotonic transport deadline bound recovery. Native maxRetries stays zero. Account creation and explicit deletion remain single-shot; neither successful `201`/`200` business outcomes nor duplicate/notfound outcomes are fabricated. The fixture collects sanitized retry histories for console summaries and api-retry-history.json attachments after teardown; attachment failures fall back to console diagnostics without replacing test errors. API-project whole-test retries were set to `0` after validation; UI diagnostics and failOnFlakyTests remain.

**Actual corrections and review:** The generator caught my cleanup-test harness shadowing its outer options with a delete-options parameter; I renamed the inner argument. Parent review requested client-level input-replay coverage in addition to the generic transport tests. The generator added assertions that query/form payloads remain identical even if caller credentials are mutated after the first attempt, and snapshots credentials before retry. Offline tests also cover deadline exhaustion and clock shifts, Retry-After forms and oversized waits, nonretryable responses, invalid schemas/JSON, arbitrary errors, response disposal, actual `404` results after deletion, redacted diagnostics, observer failure, and backoff cancellation.

**Verification:** npm run verify passed all 56 framework checks under Node 24.22.2. All four live API scenarios passed in 7.9 seconds with whole-test retries explicitly disabled and an unavailable browser installation path. A temporary local HTTP probe, using the actual framework fixtures, generated a catalogue `503 → 200` sequence and a cleanup `503 → HTTP 200/business 404` sequence. Both recovered on the same test attempt, emitted redacted report attachments including teardown, and reused the exact cleanup payload; no browser or public application mocking was involved. The temporary probe was removed after success.

The initial full CI-mode suite included all nine required scenarios and the agent seed: nine passed on their first attempt, and checkout passed on its UI retry. The report correctly classified checkout as flaky and marked the run unsuccessful under failOnFlakyTests. Its first attempt could not find the delivery-address element; inspection of the trace network records found no HTTP 5xx response, so this failure was not attributed to API 503 recovery. All four API scenarios passed without whole-test retries. No live 503 recovery occurred in these runs; the controlled local probe and offline tests provide that evidence. The checkout flake was retained for investigation, recorded below.

## Checkout readiness follow-up — 18 November 2026

**User request:** "can you complete the left over impl if anything is pending?"

The native Playwright healer reproduced the checkout failure and inspected its trace and the live cart page. The checkout anchor has no href and relies on an inline jQuery handler after blocking scripts. The failing click began before those scripts loaded, and no checkout request followed. A debug run passed without a patch, supporting the observed timing sensitivity. This corrected the earlier assumption that a visible, enabled control was sufficient evidence of application readiness for this particular interaction.

The healer added a page-load-state wait inside CartPage.proceedToCheckout before its existing click. This waits for the observed script-loading boundary without a fixed sleep, click retry, state injection, or business assertion change. API retry policy and account cleanup remain unchanged.

Two subsequent checkout runs passed with retries disabled; a third timed out loading the product page before reaching checkout. A two-worker full suite with retries disabled then produced eight passes and two failures: checkout provisioning reached a login page explicitly reporting "under heavy load (queue full)", while cart removal left its row visible. The healer inspected the cart trace and established the same readiness race: the removal click completed before jquery.js and cart.js loaded, and no removal request followed. The same load-state wait was therefore added to CartRow.remove before its existing click, preserving the removal assertions.

**Verification:** npm run verify passed all 56 framework tests after both readiness changes. A separate browser-free live API run passed all four scenarios in 7.7 seconds. Focused cart validation passed once; its second run timed out loading product details before reaching cart removal. The final full run used CI mode, one worker, and zero test retries: seven of nine scenarios passed, including all four API scenarios, cart removal, authentication, and checkout. Discovery and registration failed while waiting 30 seconds for the `/products` and `/login` page load events respectively. These navigation failures remain visible in the HTML/JUnit reports and traces; their underlying cause was not established, and no navigation retries, timeout increases, or assertion changes were introduced. No additional API retry implementation was found pending.

## Retry configuration and cart wait follow-up

The user requested moving the API retry limits to configuration and removing the load-state wait from cart removal. The limits moved to `src/config/api-retry.ts` with the existing defaults; the architecture rule now permits API clients to depend on configuration. The cart removal wait was removed as requested.

`npm run verify` passed all 56 framework tests. A live cart run with retries disabled failed because the product row remained after removal; the earlier trace had established a script-handler readiness race. Playwright's actionability checks do not establish that application event handlers are attached. The requested removal remains in place, and the failure is reported for review.

## Retry readability refactor

**User request:** After withdrawing the proposed GET-only retry policy, the user asked the native planner for a readability-only simplification, then instructed the native generator: "go ahead and implement this plan."

The generator kept the existing retry policy and extracted local elapsed-time, remaining-budget, deadline-error, and completion helpers. History construction and observer/console delivery moved into a private function in the same retry module. The API fixture became a named apiFixture function in test.ts, retaining fixture-owned history collection and attachment after dependent cleanup. Parent review checked deadline boundaries, response disposal, path redaction, observer fallback, and original-error preservation against the existing implementation. API clients, scenario assertions, retry configuration, and UI code were not changed by this refactor.

Three offline fixture tests exercise the actual clients against test doubles: first-attempt success creates no retry attachment; recovered catalogue and dependent cleanup requests both appear in the final attachment; attachment failure preserves passing and failing test outcomes while emitting sanitized fallback diagnostics. TypeScript caught an incomplete API-response test-double cast during implementation; the generator corrected the localized cast through unknown rather than adding unused mock methods. All 20 focused tests, TypeScript, focused ESLint, Prettier, and whitespace checks passed before final validation.

**Final verification:** npm run verify passed formatting, strict TypeScript, lint, architecture checks, and all 59 framework tests under Node 24. All four live API scenarios passed in 7.3 seconds in CI mode, with API whole-test retries still zero and an unavailable browser installation path. These live requests did not encounter a 503; controlled offline tests exercise recovery and its reporting. The UI suite was not rerun for this API-only refactor, so the earlier UI failures are not claimed resolved.

## API test-level retry inheritance

The user requested removing the API project's retries override to combine bounded request-level recovery with whole-test retries. Removed that override and retained the global CI setting: one whole-test retry in CI, zero locally. Request-level mutation safeguards remain per attempt; a retried test receives a fresh owned identity and attempts cleanup. A successful retry remains flaky and fails CI under failOnFlakyTests.

Playwright's resolved configuration was inspected using JSON test discovery in both modes: API retries resolved to 1 with CI=true and 0 with CI=false; failOnFlakyTests resolved to true and false respectively. Current README, decisions, and agent guidance were updated; earlier verification entries retain their historical settings.

**Verification:** After formatting the updated README table, npm run verify passed all quality checks and 59 framework tests. All four live API scenarios passed on their first attempt in CI mode in 8.1 seconds without a browser installation; no whole-test retry was needed in that run.

## API retry simplification for framework usability — 19 November 2026

**User request:** Simplify API retries to reduce boilerplate and make the framework easier to use and maintain. The accepted plan was one helper taking the request context, endpoint, and ordinary Playwright options, with essential retry behavior and one console line per retry. Implementation instruction: "okay, go ahead and implement it and test it throughly, and update the relevant docs and test cases in the repo."

Replaced the callback-based helper with `requestWithRetry(request, path, options)` using Playwright's `request.fetch()`. Removed custom retry interfaces, observer constructor arguments, history collection, runtime injection, outcome categories, and retry-history attachments. The helper shrank from 168 to 66 lines. It retains HTTP 503-only recovery, three total attempts, the 15-second monotonic transport deadline, 1s/2s fallback delays, bounded `Retry-After` handling, native `maxRetries: 0`, and discarded-response disposal. It explicitly sets `failOnStatusCode: false` so 503 responses reach the retry loop. Each actual retry prints only its method, sanitized endpoint path, HTTP status, and retry number. Creation and explicit deletion remain single-shot, and fixture cleanup still explicitly opts into retries and preserves actual business 200/404 results.

Reworked the offline retry and fixture tests around the simpler API. Coverage includes request timeouts, fallback/header delays, oversized waits, deadline boundaries, wall-clock jumps, original network/backoff errors, response disposal, log redaction, request-option forwarding, single-shot mutations, identical client inputs across retries, actual business rejection results, JSON/schema failures after recovery, and cleanup preserving a primary test failure. Clock and timer mocks live only in tests. The existing nine application scenarios and their assertions were not changed. README, architecture decisions, contribution rules, and agent workflow now describe the console-only retry reporting and callback-free request helper; earlier entries above retain their historical implementation details.

**Actual corrections:** The first patch submission tried to delete and add the helper at the same path in one patch; the patch tool rejected it before making changes, and the edit was reapplied. Two new tests initially used a nonexistent `getMockImplementation` method; TypeScript and the focused run caught this, and the harness was corrected to retain its original test-double function. Strict lint then caught an unsafe return from console mock arguments and unnecessary non-null assertions; both were corrected in the tests.

## Native cleanup reporting simplification — 19 November 2026

**User request:** After asking whether cleanup failures already fail tests, the user approved the native planner's simplification and instructed the generator: "go ahead and implement the plan above."

The planner and parent checked Playwright's fixture lifecycle and error reporting. The runner records the body/setup error before separately collecting teardown errors; its real use callback does not reject with the test body's error. This corrected the earlier assumption that custom suppression and attachments were needed to preserve primary errors in Playwright reports. A five-case temporary offline probe confirmed passing tests, cleanup-only failures, body-only failures, simultaneous body/cleanup failures, and simultaneous provisioning/cleanup failures. Its first result-parsing assertion expected a bare message while the JSON report included a source excerpt; parsing the first line corrected the probe. No application behavior was changed during that investigation.

The native generator simplified userDraftFixture to try/finally, retained the same owned-account deletion and actual HTTP/business outcome checks, and removed callback tracking, status guards, custom attachments, error normalization, and AggregateError. AccountFixtureInfo now contains only workerIndex and retry. The fixture module shrank from 172 to 124 lines. Four lifecycle tests now cover ownership, accepted deletion outcomes, cleanup after a rejected callback, and cleanup error propagation; obsolete attachment-specific tests were removed. API fixture tests were adapted to the smaller interface. All seven focused tests, TypeScript, focused ESLint, formatting, and whitespace checks passed without implementation corrections.

The parent added a permanent offline regression using the actual framework fixtures inside a temporary Playwright run. It verifies that all five outcome combinations attempt cleanup and that combined failures retain both error messages in order. Intentional child-test failures are asserted by the passing Node framework test; they are outside application discovery, use stubbed account operations, and require no browser or network. The regression passed before final suite validation. Current documentation and agent guidance now describe native teardown reporting; earlier usage entries retain their historical implementation details.

**Final verification:** Under Node 24, npm run verify passed formatting, strict TypeScript, lint, architecture checks, and all 62 framework tests. CI=true AGENT_SEED=1 npm run test:all completed with nine passing scenarios and one flaky scenario in 1.6 minutes. All five UI scenarios and the seed passed on their first attempt. API-003 received HTTP 503 on its explicit single-shot DELETE, and then passed on its whole-test retry. The first attempt's trace showed cleanup still issued a separate DELETE returning HTTP 200. A later cleanup 503 also recovered through the existing request-level retry. The CI-mode command exited 1 under failOnFlakyTests; it is not claimed as a green full-suite run. No API retry policy or business assertion was changed to hide that service failure.
