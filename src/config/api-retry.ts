/** Limits for retrying repeatable API operations after HTTP 503. */
export const apiRetryConfig = {
  maxAttempts: 3,
  operationTimeoutMs: 15_000,
} as const;
