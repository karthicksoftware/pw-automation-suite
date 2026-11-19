import { setTimeout as delay } from 'node:timers/promises';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { apiRetryConfig } from '../config/api-retry.js';

type RequestOptions = NonNullable<Parameters<APIRequestContext['fetch']>[1]>;

/** Retry a repeatable request on HTTP 503; callers decide which operations are safe to replay. */
export async function requestWithRetry(
  request: APIRequestContext,
  path: string,
  options: RequestOptions,
): Promise<APIResponse> {
  const deadline = performance.now() + apiRetryConfig.operationTimeoutMs;
  const label = `${options.method ?? 'GET'} ${new URL(path, 'https://retry.invalid').pathname}`;
  let response: APIResponse | undefined;

  try {
    for (let attempt = 1; attempt <= apiRetryConfig.maxAttempts; attempt++) {
      const remaining = deadline - performance.now();
      if (remaining <= 0) {
        if (response) return response;
        throw new Error(`API retry deadline exceeded for ${label}`);
      }
      if (attempt > 1) {
        console.warn(
          `[api-retry] ${label}: HTTP 503; retry ${attempt - 1}/${apiRetryConfig.maxAttempts - 1}`,
        );
      }
      const next = await request.fetch(path, {
        ...options,
        timeout: remaining,
        maxRetries: 0,
        failOnStatusCode: false,
      });
      await response?.dispose();
      response = next;

      if (response.status() !== 503) {
        if (performance.now() >= deadline) {
          throw new Error(`API retry deadline exceeded for ${label}`);
        }
        return response;
      }
      if (attempt === apiRetryConfig.maxAttempts) return response;

      const waitMs = retryDelay(response.headers()['retry-after'], attempt);
      if (waitMs >= deadline - performance.now()) return response;
      await delay(waitMs);
    }
  } catch (error) {
    await response?.dispose();
    throw error;
  }
  throw new Error('Unreachable API retry state');
}

function retryDelay(header: string | undefined, attempt: number): number {
  const fallback = attempt * 1_000;
  if (header === undefined) return fallback;
  const value = header.trim();
  if (/^\d+$/.test(value)) return Number(value) * 1_000;
  // Require an HTTP date: Date.parse also accepts bare numbers and malformed dates.
  if (!/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)) return fallback;
  const milliseconds = Date.parse(value) - Date.now();
  return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : fallback;
}
