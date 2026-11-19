# Native agent contribution workflow

Run `npm run agents:init` after installing dependencies or upgrading Playwright. This regenerates the supplied planner, generator, and healer for the Codex loop while preserving the fixture-aware seed. Start `codex` from the repository and trust its project configuration. Tests themselves need no AI authentication.

The parent MCP server configuration enables `AGENT_SEED=1`, exposing `tests/seed.spec.ts` in the `agent-seed` project. The seed opens the catalogue using the real framework fixtures, including the context-level Google ad blocker installed before page creation. Ordinary API/UI runs exclude it. Use that seed during exploration so generated tests observe the same network policy as CI; keep routing in the fixture rather than adding ad dismissal or request interception to business tests.

## Plan

Ask the native `playwright_test_planner` to inspect the requested journey using `tests/seed.spec.ts` and project `agent-seed`. Read AGENTS.md and the existing fixtures first. Save a short plan in specs with prerequisites, observed UI controls, business assertions, cleanup, and target file. Preserve the nine scenarios listed in README.md.

## Generate

Ask `playwright_test_generator` to implement the plan through the existing framework test/expect entrypoint, app/api fixtures, factories, and page objects. Verify interactions live with the native tools. Put new selectors in page objects and keep business assertions in tests. Assign a unique UI-NNN or API-NNN title prefix by inspecting existing tests.

Native examples sometimes use raw page operations. Translate those observations into page-object capabilities: the architecture checker rejects selector construction and raw browser/request fixtures in business tests.

## Validate and repair

Run `npm run verify`, the affected test with `npm test -- --project=ui tests/ui/<file>.spec.ts`, then `npm test` before accepting the contribution. Built-in reports and traces provide diagnostics.

Read-only API calls and fixture deletion cleanup have bounded HTTP 503 retries in the transport layer. Inspect `[api-retry]` console lines for retried requests. Keep API calls callback-free: pass the request context, endpoint, and Playwright options to `requestWithRetry`; it owns timeouts, 503 backoff, and minimal logging. Do not add observers, retry histories, or report attachments. Preserve the single-shot create/delete API contract tests, and never turn business rejections or schema failures into retries. Bounded network backoff is the only exception to the no-fixed-sleeps rule; UI actions and assertions still use observable application conditions.

API and UI tests inherit one whole-test retry in CI and zero locally. Account creation and explicit deletion remain single-shot within each attempt; a retried test receives a fresh account identity and attempts its own cleanup. A pass after a whole-test retry remains flaky and fails CI under failOnFlakyTests.

Account cleanup runs in `finally` and lets errors propagate to Playwright's native teardown reporting. A cleanup error fails a passing test; if the test already failed, the runner records both errors. Keep the offline runner regression in `tests/framework/cleanup-reporting.test.ts`; do not replace it with a rejecting fake `use` callback, which does not reproduce the runner's fixture lifecycle. No custom cleanup attachments or error aggregation are needed.

For a failure, ask `playwright_test_healer` to reproduce and inspect the failing test, preserve its intended assertions and cleanup, and apply the smallest repair. No sleeps, forced actions, skipped/focused/expected-failure tests, mocks, or state injection. Stop after two unsuccessful patches and report evidence of a product defect.

Native healer defaults may skip broken functionality; repository lint and architecture checks reject that result. There is no custom mandatory-scenario registry. Review the README's critical-flow list and test diff to detect deleted coverage or weakened assertions.

Record actual prompts, output, mistakes, corrections, and verification in AI_USAGE.md. Historical native planner/generator/healer execution is recorded there; the optional demo source and separate prompt documents were removed during simplification.
