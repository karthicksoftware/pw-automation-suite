import { setTimeout as delay } from 'node:timers/promises';
import type { APIResponse } from '@playwright/test';
import { apiRetryConfig } from '../config/api-retry.js';

export interface ApiRetryAttempt {
  readonly attempt: number;
  readonly status?: number;
  readonly elapsedMs: number;
  delayMs?: number;
}

export interface ApiRetryHistory {
  readonly operation: string;
  readonly method: 'GET' | 'POST' | 'DELETE';
  readonly path: string;
  readonly attempts: readonly ApiRetryAttempt[];
  readonly outcome: 'recovered' | 'exhausted' | 'stopped' | 'failed';
  readonly elapsedMs: number;
}

export type ApiRetryObserver = (history: ApiRetryHistory) => void;

interface RequestOptions {
  readonly timeout: number;
  readonly maxRetries: 0;
}

interface RetryOperation {
  readonly operation: string;
  readonly method: ApiRetryHistory['method'];
  readonly path: string;
  readonly observer?: ApiRetryObserver | undefined;
}

interface RetryRuntime {
  readonly now: () => number;
  readonly wallNow: () => number;
  readonly wait: (milliseconds: number) => Promise<void>;
}

const runtime: RetryRuntime = {
  now: () => performance.now(),
  wallNow: () => Date.now(),
  wait: (milliseconds) => delay(milliseconds),
};

/** Replay a known-repeatable operation on HTTP 503, before parsing its final response. */
export async function requestWithRetry(
  send: (options: RequestOptions) => Promise<APIResponse>,
  operation: RetryOperation,
  clock: RetryRuntime = runtime,
): Promise<APIResponse> {
  const started = clock.now();
  const attempts: ApiRetryAttempt[] = [];
  const details = {
    ...operation,
    path: new URL(operation.path, 'https://retry.invalid').pathname,
  };
  const elapsed = () => clock.now() - started;
  const remainingBudget = () => apiRetryConfig.operationTimeoutMs - elapsed();
  const deadlineError = () =>
    new Error(`API retry deadline exceeded for ${details.method} ${details.path}`);
  let previous: APIResponse | undefined;

  function report(outcome: ApiRetryHistory['outcome']): void {
    if (!attempts.some((attempt) => attempt.status === 503)) return;
    reportRetryHistory(details, attempts, outcome, elapsed());
  }

  function finish(response: APIResponse, outcome: ApiRetryHistory['outcome']): APIResponse {
    report(outcome);
    return response;
  }

  for (let attempt = 1; attempt <= apiRetryConfig.maxAttempts; attempt++) {
    const remainingBeforeRequest = remainingBudget();
    if (remainingBeforeRequest <= 0) {
      report('exhausted');
      if (previous) return previous;
      throw deadlineError();
    }
    let response: APIResponse;
    try {
      response = await send({
        timeout: remainingBeforeRequest,
        maxRetries: 0,
      });
    } catch (error) {
      await previous?.dispose();
      attempts.push({ attempt, elapsedMs: elapsed() });
      report('failed');
      throw error;
    }
    // Retain the last response until its replacement arrives, including across a backoff wait.
    await previous?.dispose();
    previous = response;
    const status = response.status();
    const entry: ApiRetryAttempt = { attempt, status, elapsedMs: elapsed() };
    attempts.push(entry);
    const remaining = apiRetryConfig.operationTimeoutMs - entry.elapsedMs;

    if (remaining <= 0 && status !== 503) {
      await response.dispose();
      report('exhausted');
      throw deadlineError();
    }
    if (status !== 503) {
      return finish(response, response.ok() ? 'recovered' : 'stopped');
    }
    if (attempt === apiRetryConfig.maxAttempts || remaining <= 0) {
      return finish(response, 'exhausted');
    }

    const waitMs = retryDelay(response.headers()['retry-after'], attempt, clock.wallNow());
    if (waitMs >= remaining) {
      return finish(response, 'exhausted');
    }
    entry.delayMs = waitMs;
    try {
      await clock.wait(waitMs);
    } catch (error) {
      await response.dispose();
      report('failed');
      throw error;
    }
    if (remainingBudget() <= 0) {
      return finish(response, 'exhausted');
    }
  }
  throw new Error('Unreachable API retry state');
}

/** Snapshot retry evidence and fall back safely when the observer cannot report it. */
function reportRetryHistory(
  operation: RetryOperation,
  attempts: readonly ApiRetryAttempt[],
  outcome: ApiRetryHistory['outcome'],
  elapsedMs: number,
): void {
  const history: ApiRetryHistory = {
    operation: operation.operation,
    method: operation.method,
    path: operation.path,
    attempts: attempts.map((attempt) => ({ ...attempt })),
    outcome,
    elapsedMs,
  };
  if (operation.observer) {
    try {
      operation.observer(history);
      return;
    } catch {
      // Diagnostic failures must not replace transport outcomes or disclose exception payloads.
    }
  }
  console.warn('API retry history:', JSON.stringify(history));
}

function retryDelay(header: string | undefined, attempt: number, wallNow: number): number {
  const fallback = attempt * 1_000;
  if (header === undefined) return fallback;
  const value = header.trim();
  if (/^\d+$/.test(value)) return Number(value) * 1_000;
  // Date.parse also accepts bare numbers and malformed dates; require an HTTP-date shape.
  if (!/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)) return fallback;
  const milliseconds = Date.parse(value) - wallNow;
  return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : fallback;
}
