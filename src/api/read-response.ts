import type { APIResponse } from '@playwright/test';
import type { z } from 'zod';
import type { ApiResult } from '../domain/contracts.js';

/**
 * Parses JSON even when the app labels it text/html, retaining business rejection responses.
 * @throws For unsuccessful HTTP transport, malformed JSON, or a response-schema mismatch.
 */
export async function readResponse<T extends z.ZodType>(
  response: APIResponse,
  schema: T,
): Promise<ApiResult<z.output<T>>> {
  // This app sends JSON with text/html and encodes business errors inside HTTP 200.
  // Validate content, not a misleading content-type header.
  const httpStatus = response.status();
  if (!response.ok()) {
    throw new Error(
      `API transport failure: HTTP ${httpStatus} at ${new URL(response.url()).pathname}`,
    );
  }
  const payload: unknown = await response.json();
  return { httpStatus, body: schema.parse(payload) };
}

/** Fixture precondition/cleanup guard. Business tests use the shared expect matcher instead. */
export function requireResponseCode(
  result: ApiResult<{ responseCode: number }>,
  expected: number | readonly number[],
  operation: string,
): void {
  const codes = typeof expected === 'number' ? [expected] : expected;
  if (result.httpStatus !== 200 || !codes.includes(result.body.responseCode)) {
    throw new Error(
      `${operation}: HTTP ${result.httpStatus}, responseCode ${result.body.responseCode}; expected HTTP 200 and responseCode ${codes.join(' or ')}`,
    );
  }
}
