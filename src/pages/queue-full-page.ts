import { setTimeout as delay } from 'node:timers/promises';
import type { Page, Response } from '@playwright/test';

/** Limits shared by all queue-recovery invocations on one test-scoped page. */
export interface QueueRecoveryOptions {
  /** Maximum total refreshes across the page's lifetime. */
  readonly maxReloads: number;
  /** Cumulative recovery time in milliseconds; ordinary test steps do not consume it. */
  readonly timeoutMs: number;
  /** Base fallback delay in milliseconds, multiplied by the next refresh number. */
  readonly backoffMs: number;
}

const QUEUE_HEADING = 'This website is under heavy load (queue full)';
const READ_ONLY_PATH = /^\/(?:login|products|view_cart|product_details\/\d+)$/;

/**
 * Registers recovery for the observed queue-full heading on a verified HTTP 503 document.
 *
 * Only matching, same-origin GET documents on reviewed read-only routes can be refreshed;
 * every request in a redirect chain must satisfy the same restrictions. Recovery reloads
 * the current URL, including its query, and logs only the method, path, and refresh count.
 *
 * Playwright invokes the handler before actions or auto-waiting assertions. Refresh counts
 * and recovery time are shared across invocations on this page. Refused or exhausted
 * recovery throws inside the handler and is reported by Playwright Test. A navigation
 * timeout that occurs before the handler runs remains a normal test failure.
 *
 * @param page Isolated test page; install before its first navigation.
 * @param baseURL Trusted application URL used to establish the allowed origin, not a destination.
 * @param options Refresh, time-budget, and fallback-backoff limits for this page.
 * @returns Resolves once tracking and the handler are installed, not once recovery occurs.
 */
export async function installQueueRecovery(
  page: Page,
  baseURL: string,
  options: QueueRecoveryOptions,
): Promise<void> {
  const origin = new URL(baseURL).origin;
  const queue = page.getByRole('heading', { name: QUEUE_HEADING, exact: true });
  let document: Response | undefined;
  let reloads = 0;
  let spentMs = 0;

  page.on('response', (response) => {
    if (response.request().isNavigationRequest() && response.frame() === page.mainFrame()) {
      document = response;
    }
  });

  await page.addLocatorHandler(queue, async () => {
    const started = performance.now();
    /** Remaining recovery milliseconds, including earlier invocations; may be zero or negative. */
    const remaining = () => options.timeoutMs - spentMs - (performance.now() - started);
    /** Diagnostic method and current path, excluding credentials, query parameters, and fragments. */
    const label = () =>
      `${document?.request().method() ?? 'UNKNOWN'} ${new URL(page.url()).pathname}`;
    /** Builds the exhaustion error with the cumulative refresh count and configured time limit. */
    const exhausted = () =>
      new Error(
        `Queue-full recovery exhausted for ${label()}: page remains unavailable after ${reloads} refreshes (${options.timeoutMs}ms budget).`,
      );
    /**
     * Returns the current document response only when it is eligible for refresh.
     * Rechecking after backoff prevents refreshing a replacement form or unsafe navigation.
     * @throws If document evidence is missing, stale, or outside the approved recovery scope.
     */
    const safeDocument = (): Response => {
      if (!document || !isSafeDocument(document, page.url(), origin)) {
        throw new Error(
          `Queue-full recovery refused for ${label()}: expected a same-origin read-only GET document with HTTP 503.`,
        );
      }
      return document;
    };
    try {
      // A handler must remove its triggering heading before returning to the interrupted action.
      while (await queue.isVisible()) {
        const source = safeDocument();
        if (reloads >= options.maxReloads || remaining() <= 0) throw exhausted();
        const waitMs = retryDelay(
          source.headers()['retry-after'],
          options.backoffMs * (reloads + 1),
        );
        if (waitMs >= remaining()) throw exhausted();
        await delay(waitMs);
        if (remaining() <= 0) throw exhausted();
        // Navigation may change during backoff; never refresh a replacement form document.
        if (!(await queue.isVisible())) return;
        safeDocument();
        const timeout = remaining();
        if (timeout <= 0) throw exhausted();
        reloads++;
        console.warn(
          `[ui-recovery] ${label()}: HTTP 503 queue full; refresh ${reloads}/${options.maxReloads}`,
        );
        // Queue pages are complete HTML documents; inspect them without waiting for other assets.
        document = (await page.reload({ timeout, waitUntil: 'domcontentloaded' })) ?? undefined;
        if (remaining() <= 0) throw exhausted();
      }
    } catch (error) {
      if (remaining() <= 0) throw exhausted();
      throw error;
    } finally {
      spentMs += performance.now() - started;
    }
  });
}

/**
 * Checks the tracked document's status, URL, route, and complete redirect chain.
 * Main-frame navigation filtering happens when the response is captured by the installer.
 * URL comparison includes the query string and ignores the fragment, which is not sent to servers.
 *
 * @param response Latest tracked main-document response.
 * @param currentURL Current browser URL, used to reject responses from an earlier navigation.
 * @param origin Trusted application origin, including its scheme and port.
 * @returns True only for HTTP 503 on a matching reviewed GET route with safe redirect ancestry.
 */
function isSafeDocument(response: Response, currentURL: string, origin: string): boolean {
  const url = new URL(response.url());
  const current = new URL(currentURL);
  if (
    response.status() !== 503 ||
    url.origin !== origin ||
    !READ_ONLY_PATH.test(url.pathname) ||
    `${url.origin}${url.pathname}${url.search}` !==
      `${current.origin}${current.pathname}${current.search}`
  )
    return false;
  for (let request = response.request(); request;) {
    const requestURL = new URL(request.url());
    if (
      request.method() !== 'GET' ||
      requestURL.origin !== origin ||
      !READ_ONLY_PATH.test(requestURL.pathname)
    )
      return false;
    const previous = request.redirectedFrom();
    if (!previous) break;
    request = previous;
  }
  return true;
}

/**
 * Converts Retry-After delta-seconds or a future HTTP date to a delay in milliseconds.
 * Zero seconds is accepted; missing, invalid, or past values use the supplied fallback.
 * The caller checks the delay against its remaining budget before waiting.
 *
 * @param header Retry-After value from the verified HTTP 503 document, if supplied.
 * @param fallback Backoff delay in milliseconds for the next refresh attempt.
 * @returns Server-requested delay in milliseconds, or the fallback when parsing fails.
 */
function retryDelay(header: string | undefined, fallback: number): number {
  if (header === undefined) return fallback;
  const value = header.trim();
  if (/^\d+$/.test(value)) return Number(value) * 1_000;
  if (!/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)) return fallback;
  const milliseconds = Date.parse(value) - Date.now();
  return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : fallback;
}
