import { test as base, type APIRequestContext } from '@playwright/test';
import { expect } from '../assertions/api-expect.js';
import { AccountsClient } from '../api/accounts-client.js';
import { CatalogClient } from '../api/catalog-client.js';
import { requireResponseCode } from '../api/read-response.js';
import { environment } from '../config/environment.js';
import { uiRecoveryConfig } from '../config/ui-recovery.js';
import { createUser } from '../data/user-factory.js';
import type { Account, UserDraft } from '../domain/models.js';
import type { Product } from '../domain/contracts.js';
import { Application } from '../pages/application.js';
import { installQueueRecovery } from '../pages/queue-full-page.js';

const GOOGLE_AD_DOMAINS = ['doubleclick.net', 'googlesyndication.com'];

/** Match advertising hosts only, never a domain mentioned in an application URL or query. */
export function isGoogleAdUrl(url: URL): boolean {
  return GOOGLE_AD_DOMAINS.some(
    (domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`),
  );
}

export interface ApiClients {
  readonly accounts: AccountsClient;
  readonly catalog: CatalogClient;
}

export interface FrameworkFixtures {
  readonly app: Application;
  readonly api: ApiClients;
  readonly userDraft: UserDraft;
  readonly account: Account;
  readonly authenticatedApp: Application;
  readonly product: Product;
}

interface AccountCleanupClient {
  delete: AccountsClient['delete'];
}

interface ProductCatalogClient {
  products: CatalogClient['products'];
}

interface AccountFixtureInfo {
  workerIndex: number;
  retry: number;
}

/** Share API clients within one test; the transport helper logs retries directly. */
export async function apiFixture(
  { request }: { request: APIRequestContext },
  use: (api: ApiClients) => Promise<void>,
): Promise<void> {
  await use({
    accounts: new AccountsClient(request),
    catalog: new CatalogClient(request),
  });
}

/** Own an account identity and attempt cleanup even when provisioning or the test fails. */
export async function userDraftFixture(
  { api }: { api: { accounts: AccountCleanupClient } },
  use: (user: UserDraft) => Promise<void>,
  testInfo: AccountFixtureInfo,
): Promise<void> {
  const user = createUser(environment.runId, testInfo.workerIndex, testInfo.retry);
  try {
    await use(user);
  } finally {
    await cleanupOwnedAccount(api.accounts, user);
  }
}

/** Use the first live catalogue product without depending on a particular name or ID. */
export async function productFixture(
  { api }: { api: { catalog: ProductCatalogClient } },
  use: (product: Product) => Promise<void>,
): Promise<void> {
  const result = await api.catalog.products();
  requireResponseCode(result, 200, 'Load product fixture');
  const [product] = result.body.products;
  if (!product) throw new Error('Cannot load product fixture: the catalogue is empty');
  await use(product);
}

export const test = base.extend<FrameworkFixtures>({
  context: async ({ context }, use) => {
    // Install before the page fixture creates a page; includes iframe and popup traffic.
    await context.route(isGoogleAdUrl, (route) => route.abort('blockedbyclient'));
    await use(context);
  },

  /** Installs queue recovery before exposing the page; API-only tests leave this fixture unused. */
  page: async ({ page }, use) => {
    await installQueueRecovery(page, environment.baseURL, uiRecoveryConfig);
    await use(page);
  },

  api: apiFixture,

  app: async ({ page }, use) => {
    await use(new Application(page));
  },

  userDraft: userDraftFixture,

  account: async ({ api, userDraft }, use) => {
    requireResponseCode(await api.accounts.create(userDraft), 201, 'Provision test account');
    await use(userDraft);
  },

  authenticatedApp: async ({ app, account }, use) => {
    await app.auth.goto();
    await app.auth.login(account);
    await expect(app.header.loggedInUser).toContainText(account.name);
    await use(app);
  },

  product: productFixture,
});

export { expect };
export { expectCartLine } from '../assertions/cart.js';

/** Delete only the identity owned by this fixture; an already absent account is acceptable. */
async function cleanupOwnedAccount(accounts: AccountCleanupClient, user: UserDraft): Promise<void> {
  const result = await accounts.delete(user, { retryOn503: true });
  // Signup may fail before creation; the API lifecycle test also deletes explicitly.
  requireResponseCode(result, [200, 404], 'Clean up owned account');
}
