# Framework contribution rules

This repository tests the public Automation Exercise practice application. Accounts and payment details are synthetic. You may run the tests and clean up accounts owned by the current test run.

## Commands

- `npm ci` and `npx playwright install chromium` prepare a checkout.
- `npm run verify` runs formatting, TypeScript, lint, architecture, and framework checks.
- `npm test -- --project=ui tests/ui/discovery.spec.ts` runs one affected scenario.
- `npm run test:all` runs the nine critical API/UI scenarios; API-only is `npm run test:api`.

## Architecture

- Import `test` and `expect` from `src/fixtures/fixtures.ts` (using the `.js` import extension) in every application test.
- Offline framework tests live in `tests/framework` and use Node's test runner. The architecture checker and its tests live together in `tests/framework/architecture`; `scripts` contains only native agent initialization.
- Business tests choose expected outcomes. Shared matchers and repeated UI validations live in src/assertions and are exported through the fixture entrypoint. Page objects/components own selectors and UI operations. API clients own HTTP calls. Fixtures own account lifetime.
- Reuse `app`, `api`, `userDraft`, `account`, and `authenticatedApp`. Never share a writable account or authenticated browser state across tests.
- Keep owned-account cleanup in `finally` and let teardown errors propagate to Playwright's native reporting. Do not add custom cleanup attachments, status guards, or error aggregation.
- Use expect(result).toHaveApiOutcome(...) for HTTP/business outcome checks and expectCartLine(...) for repeated cart-line checks. Keep scenario-specific assertions visible.
- Inspect existing types and components before creating another abstraction. Prefer composition; do not introduce a base-page hierarchy.
- Every application test has a unique `UI-NNN` or `API-NNN` title prefix. Review changes against the nine critical scenarios listed in README.md; there is no custom coverage registry.

## Agent loop and repairs

Use the native Playwright planner, generator, and healer with the Codex loop. Read `specs/agent-workflow.md` before generating or repairing code. `tests/seed.spec.ts` is the fixture example; it is only selected with `AGENT_SEED=1`.

- Verify selectors against the live app. Do not guess selectors from prose.
- No fixed sleeps, forced interactions, focused/skipped/expected-failure tests, empty tests, or floating Playwright promises.
- Bounded HTTP 503 backoff is allowed only in the API retry helper and the reviewed queue-page recovery helper. Keep their attempt/deadline limits and one sanitized method/path console line per retry or refresh; do not add retry histories, observers, or report attachments; never add sleeps or assertion retries to business tests. Account creation and explicit deletion stay single-shot within a test attempt; only fixture cleanup opts into deletion retries. API and UI tests inherit one whole-test retry in CI, with fresh account identities per attempt; flaky outcomes still fail CI.
- Install queue recovery through the page fixture before use. Require the exact queue-full heading plus a matching HTTP 503 main-document response on a reviewed same-origin read-only GET route. Never refresh form submissions, POST-origin redirects, unknown routes, or mutating GETs. Keep the per-page refresh cap and cumulative recovery-time budget; do not mask exhausted recovery.
- Do not mock critical flows, inject application state, or change the application under test. The context fixture may abort only the reviewed Google advertising domains (`doubleclick.net`, `googlesyndication.com` and their subdomains). Keep application endpoints live and routing out of business tests; verify network evidence before expanding this list.
- A repair must preserve the scenario, assertions, and cleanup. Never delete a required ID, weaken assertions, or skip a failing scenario to obtain green results.
- Stop a repair after two unsuccessful patches and report the evidence. A product defect stays a failing test.
- Keep generated agent definitions separate from these project rules; run `npm run agents:init` after a Playwright upgrade and review the diff.

## Completion

Run `npm run verify` and affected tests. Record what actually ran and any external blockers. Update `AI_USAGE.md` with real prompts, corrections, and verification; never invent AI evidence. Keep secrets, browser state, the confidential assignment PDF, and raw transcripts out of Git.
