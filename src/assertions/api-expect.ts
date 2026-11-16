import { expect as baseExpect } from '@playwright/test';
import type { ApiResult } from '../domain/contracts.js';

export interface ApiOutcome {
  readonly httpStatus: number;
  readonly responseCode: number;
  readonly message?: string;
}

/** Shared snapshot assertion; no requests, retries, or implicit success expectations. */
export const expect = baseExpect.extend({
  toHaveApiOutcome(
    received: ApiResult<{ responseCode: number; message?: string }>,
    expected: ApiOutcome,
  ) {
    const actual = {
      httpStatus: received.httpStatus,
      responseCode: received.body.responseCode,
      ...(expected.message === undefined ? {} : { message: received.body.message }),
    };
    const pass =
      received.httpStatus === expected.httpStatus &&
      received.body.responseCode === expected.responseCode &&
      (expected.message === undefined || received.body.message === expected.message);
    return {
      name: 'toHaveApiOutcome',
      pass,
      actual,
      expected,
      message: () =>
        this.utils.matcherHint('toHaveApiOutcome', undefined, undefined, { isNot: this.isNot }) +
        '\n\n' +
        this.utils.printDiffOrStringify(
          expected,
          actual,
          'Expected outcome',
          'Received outcome',
          false,
        ),
    };
  },
});
