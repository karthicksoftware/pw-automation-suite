/**
 * Default bounds passed by the page fixture to queue recovery:
 * two total refreshes, 15 seconds of cumulative handler time, and 1s/2s fallback delays.
 * All time values are milliseconds; ordinary test execution does not consume the budget.
 */
export const uiRecoveryConfig = {
  maxReloads: 2,
  timeoutMs: 15_000,
  backoffMs: 1_000,
} as const;
