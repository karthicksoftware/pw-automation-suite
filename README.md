# 🚀 Agentic-First Playwright Automation Suite (`pw-automation-suite`)

**Target Application:** [Automation Exercise](https://automationexercise.com)  
**Tech Stack:** Playwright `1.65` · TypeScript `5.9` (Strict ESM) · Zod `4.6` · Node.js `24 LTS` · Codex MCP Agents

An agent-native end-to-end and API test framework covering **5 critical UI journeys**, **4 API contract scenarios**, and **75 offline AST/framework checks**—designed so both engineers and AI coding agents contribute safely through a single typed fixture surface.

> [!TIP]
> **Zero-Config Local Execution**
> You do **not** need a `.env` file, pre-existing test credentials, or an OpenAI/Codex API key to run the test suite. Every mutating test provisions and cleans up its own isolated synthetic customer automatically, and API-only tests require no browser installation.

## ⚡ 1. Quick Start (Clone, Install & Run in 60 Seconds)

**Prerequisites:** **Node.js 24 LTS** (`.nvmrc` included) and internet access to `https://automationexercise.com`.

```bash
# 1. Clone the repository and enter the project folder
git clone git@github.com:karthicksoftware/pw-automation-suite.git
cd pw-automation-suite

# 2. Use Node 24 LTS (optional if Node >= 24 is already active)
nvm install
nvm use

# 3. Install locked dependencies and the Chromium browser binary
npm ci
npx playwright install chromium
# (On Linux / Ubuntu, use: npx playwright install --with-deps chromium)

# 4. Run static verification (Prettier, TypeScript, ESLint, AST rules, 75 offline unit checks)
npm run verify

# 5. Execute all 9 critical API & UI scenarios
npm test
```

## 🧰 2. Command Reference

| Command                                               | Purpose                                                                          |
| :---------------------------------------------------- | :------------------------------------------------------------------------------- |
| `npm test` or `npm run test:all`                      | Run all **9 application scenarios** (4 API + 5 Chromium UI)                      |
| `npm run test:api`                                    | Run the **4 API contract tests** without launching a browser                     |
| `npm run test:ui`                                     | Run the **5 Chromium UI journeys**                                               |
| `npm test -- --project=ui tests/ui/discovery.spec.ts` | Run a single test file                                                           |
| `npm run test:ui -- --headed`                         | Run UI tests with a visible browser                                              |
| `npm run test:ui -- --debug`                          | Open Playwright Inspector                                                        |
| `npm test -- --workers=2`                             | Override worker count                                                            |
| `npm run test:ui -- --shard=1/2`                      | Run native Playwright CLI sharding                                               |
| `npm run verify`                                      | Run **formatting, types, lint, architecture rules, and 75 framework unit tests** |
| `npm run test:framework`                              | Run only the 75 offline framework unit tests (Node test runner)                  |
| `npm run check:architecture`                          | Run the repository AST architecture checker directly                             |
| `npm run report`                                      | Open the latest HTML report (`playwright-report/index.html`)                     |
| `npm run format`                                      | Format the repository with Prettier                                              |

## 🗂️ 3. Project Structure & Architecture

| Folder                         | Responsibility                                                                             |
| :----------------------------- | :----------------------------------------------------------------------------------------- |
| `tests/ui`, `tests/api`        | Business assertions for application journeys (`UI-001`–`UI-005`) and API (`API-001`–`004`) |
| `src/fixtures`                 | Single test entrypoint (`fixtures.ts`), account ownership, authentication, and cleanup     |
| `src/pages`                    | Page objects, shared UI components, and their `Application` composition root               |
| `src/assertions`               | Shared `toHaveApiOutcome` API matcher and web-first `expectCartLine` assertions            |
| `src/api`                      | Account/catalogue clients, form mappers, and runtime Zod response validation               |
| `src/data`                     | Unique synthetic user (`createUser`) and payment (`createPayment`) factories               |
| `src/domain`                   | Domain types, Zod response schemas, and integer-paise currency calculations                |
| `src/config`                   | Validated environment settings and bounded API/UI recovery limits                          |
| `scripts`                      | Seed-preserving native agent initialization (`init-agents.mjs`)                            |
| `tests/framework`              | 75 offline unit tests covering AST rules, account cleanup, ad-blocking, API, and money     |
| `tests/framework/architecture` | Repository AST architecture checker, file discovery helper, and checker unit tests         |
| `specs`, `AGENTS.md`, `.codex` | Agent contribution workflow, repository rules, native agents, and MCP configuration        |
| `.github/workflows`            | CI quality gate, API job, and Chromium UI job                                              |

### Reusable Requests & Assertions (Single Import Surface)

Tests import `test`, `expect`, and `expectCartLine` from `src/fixtures/fixtures.ts`. Page Objects own selectors and interactions without imposing success assertions; tests own business expectations:

```ts
// Declarative HTTP + business responseCode assertion (redacts full payload from failure diffs)
const created = await api.accounts.create(userDraft);
expect(created).toHaveApiOutcome({
  httpStatus: 200,
  responseCode: 201,
  message: 'User created!',
});

// Shared web-first cart & checkout line assertion with polled integer-paise total
await expectCartLine(row, {
  name: product.name,
  quantity,
  unitPrice: product.price,
  totalPaise: rupeesToPaise(product.price) * quantity,
});
```

### Bounded API Transport Retries

Read-only catalogue/search, account lookup, and credential verification retry **HTTP 503 only**, with **3 total attempts**, fallback delays of **1s then 2s**, and a **15s transport deadline** covering requests and backoff. A valid `Retry-After` is honored only when another request fits the remaining budget; an excessive delay stops recovery rather than sending early. Other HTTP failures, business `responseCode` errors, invalid JSON, and schema failures retain their original behavior.

Creation and explicit account deletion remain single-shot because a failed response can hide a completed mutation. Fixture cleanup explicitly opts deletion into recovery and continues accepting actual business `200/404` results. No successful business response is fabricated. Native request `maxRetries` is disabled so transport retries do not multiply.

Clients pass the request context, endpoint, and ordinary Playwright request options to one helper. It uses `request.fetch()` internally; `method` controls the HTTP method, and `form`, `data`, `headers`, and `params` retain their normal Playwright meanings:

```ts
const response = await requestWithRetry(this.request, CATALOG_ROUTES.search, {
  method: 'POST',
  form: { search_product: query },
});
return readResponse(response, productsSchema);
```

The helper controls request timeouts and disables native retries and `failOnStatusCode` so it can inspect 503 responses. Limits live in [`src/config/api-retry.ts`](src/config/api-retry.ts). Immediately before each retry request, it prints one line:

```text
[api-retry] POST /api/searchProduct: HTTP 503; retry 1/2
```

First-attempt success and operations that stop without retrying produce no retry message. Logs contain only the method, endpoint path, status, and retry number; payloads, credentials, headers, URL queries, and fragments are excluded. Retry reporting needs no observers, stored histories, or report attachments. The final response still goes through normal HTTP, JSON, Zod, and business validation.

API and UI tests inherit one whole-test retry in CI and zero locally. Each test attempt owns its account identity and cleanup; creation and explicit deletion remain single-shot within an attempt. Tests that pass only on a whole-test retry are classified as flaky and still fail CI. Browser navigation failures are outside the request-level retry policy.

### Queue-Full Page Recovery

The page fixture installs one `addLocatorHandler` before page use. It recognizes the exact heading **This website is under heavy load (queue full)** and refreshes only when the current main document returned HTTP 503 for a reviewed same-origin GET page: `/login`, `/products`, `/product_details/<id>`, or `/view_cart`. POST submissions, POST-origin redirects, mutating GET routes, unknown pages, and unrelated errors are not refreshed.

[`src/config/ui-recovery.ts`](src/config/ui-recovery.ts) sets **2 refreshes per page/test**, a **15-second cumulative recovery budget**, and **1s/2s fallback delays**. Valid `Retry-After` headers are honored when they fit the remaining budget. Only time spent inside recovery consumes the budget. Each actual refresh logs a sanitized line such as `[ui-recovery] GET /products: HTTP 503 queue full; refresh 1/2`.

If the queue persists or recovery is refused, Playwright fails the attempt and retains native failure artifacts; owned-account cleanup still runs. Recovery activates before an action or auto-waiting assertion, so it cannot rescue an already timed-out navigation. Reloads wait for DOMContentLoaded to inspect the replacement document; business assertions continue to verify the expected application state. API-only execution does not instantiate the page fixture or launch a browser.

## 🔌 4. Fixtures, Data Isolation & Network Policy

| Fixture            | Description                                                                                                      |
| :----------------- | :--------------------------------------------------------------------------------------------------------------- |
| `app`              | Composed Page Objects (`Application`) using a fresh, isolated browser context                                    |
| `api`              | Request-based `accounts` and `catalog` clients with zero browser dependency                                      |
| `userDraft`        | Unique synthetic identity (`userDraftFixture`) with teardown cleanup registered _before_ account creation        |
| `account`          | API-provisioned customer (`POST /api/createAccount`), automatically deleted during teardown                      |
| `authenticatedApp` | Logs that isolated `account` in through the real `/login` UI                                                     |
| `product`          | Selects the first product returned by the live catalogue without a fixed name or ID (`UI-003` searches its name) |

> [!IMPORTANT]
> **Isolation, Validation & Ad-Blocking Guarantees**
>
> - **Native Account Teardown Reporting:** `userDraftFixture` in `src/fixtures/fixtures.ts` owns the identity and attempts cleanup in `finally`, including after provisioning or test failures. Cleanup errors propagate to Playwright: they fail an otherwise passing test and are recorded alongside an existing test error. No custom cleanup attachments or error aggregation are needed.
> - **Dual-Layer API Validation & Paise Math:** The app sends JSON with a `text/html` content-type and may return `HTTP 200` for business errors. Clients validate payloads with **Zod**, tests verify HTTP status and JSON `responseCode` separately, and currency is compared in integer paise (`rupeesToPaise`).
> - **Context-Level Google Ad Blocking:** The `context` fixture aborts requests only to `doubleclick.net`, `googlesyndication.com`, and their subdomains (`blockedbyclient`) before page creation and blocks service workers so routing cannot be bypassed. All application endpoints and non-ad Google assets remain live.

## 🎯 5. Critical Scenarios (`9 Required Flows`)

| ID          | Layer | Coverage                                                                            |
| :---------- | :---- | :---------------------------------------------------------------------------------- |
| **UI-001**  | UI    | UI registration, displayed logged-in identity, and backend account verification     |
| **UI-002**  | UI    | Provisioned customer UI login and logout                                            |
| **UI-003**  | UI    | Search result parity with the live API, product card details, and detail page price |
| **UI-004**  | UI    | Cart quantity, calculated integer-paise total, item removal, and empty-cart state   |
| **UI-005**  | UI    | Checkout delivery/billing addresses, totals, synthetic payment, and confirmation    |
| **API-001** | API   | Catalogue Zod schema validation, unique product IDs, and positive prices            |
| **API-002** | API   | Exact search result IDs (`searchProduct`), including category matches (`Tops`)      |
| **API-003** | API   | Create, retrieve by email, authenticate (`verifyLogin`), delete, and verify `404`   |
| **API-004** | API   | Incorrect-password rejection (`404`) for an existing provisioned account            |

## ⚙️ 6. Configuration

Defaults work without an environment file. Optionally copy `.env.example` to `.env`:

| Variable      | Default                                                                        |
| :------------ | :----------------------------------------------------------------------------- |
| `BASE_URL`    | `https://automationexercise.com`                                               |
| `WORKERS`     | `2` locally, `1` when `CI=true` (allowed range `1`–`8`)                        |
| `TEST_RUN_ID` | Generated run namespace for disposable synthetic accounts                      |
| `CI`          | Unset; `'true'` enables 1 whole-test retry for API and UI; flaky outcomes fail |

## 🤖 7. Native AI Agents & CI Reports

- **Native Playwright Agents (`Codex` Loop):** After installing and authenticating the Codex CLI, run `npm run agents:init` and start `codex` from the repository root. The script selects `--project=ui` and preserves `tests/seed.spec.ts`. To run the opt-in agent seed manually:
  ```bash
  AGENT_SEED=1 npm test -- --project=agent-seed
  ```
- **Contribution Guardrails:** Follow [AGENTS.md](AGENTS.md) and [specs/agent-workflow.md](specs/agent-workflow.md). `npm run verify` rejects raw `@playwright/test` imports, inline spec selectors, forbidden layer imports, sleeps, forced UI actions, skipped/focused tests, constant assertions, and floating promises.
- **GitHub Actions & Trace Diagnostics:** `.github/workflows/playwright.yml` runs the `quality` gate (`npm run verify`) before independent `api` and `ui` jobs (`WORKERS=1`, 1 whole-test retry, `failOnFlakyTests: true`, no AI in CI). Built-in HTML/JUnit reports, failure traces, and screenshots are retained for 7 days. Locally, inspect `playwright-report/index.html` or run `npx playwright show-trace <trace.zip>`.
- **Architecture & AI Logs:** See **[DECISIONS.md](DECISIONS.md)** for the 6 key architecture decisions and **[AI_USAGE.md](AI_USAGE.md)** for prompts, AI mistakes caught, corrections, and verification evidence.
