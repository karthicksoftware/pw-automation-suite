import { randomUUID } from 'node:crypto';
import type { PaymentDetails, UserDraft } from '../domain/models.js';

/** Produces synthetic domain data unique across runs, workers, and retries; creates no remote user. */
export function createUser(runId: string, worker: number, retry: number): UserDraft {
  const run =
    runId
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '')
      .slice(0, 24) || 'local';
  const unique = randomUUID().replaceAll('-', '');
  return {
    email: `pw.${run}.w${worker}.r${retry}.${unique}@example.com`,
    password: `Qa!${randomUUID()}9`,
    name: `QA ${unique.slice(0, 10)}`,
    title: 'Mr',
    birthDate: { day: '15', month: '6', year: '1992' },
    firstName: 'Automation',
    lastName: `User${unique.slice(0, 8)}`,
    company: 'Synthetic QA Company',
    address1: '42 Test Avenue',
    address2: 'Suite 5',
    country: 'India',
    state: 'Karnataka',
    city: 'Bengaluru',
    zipcode: '560001',
    mobileNumber: '9000000000',
  };
}

/** Returns practice-only payment details for an isolated checkout scenario. */
export function createPayment(nameOnCard: string): PaymentDetails {
  return {
    nameOnCard,
    cardNumber: '4242424242424242',
    cvc: '123',
    expiryMonth: '12',
    expiryYear: '2035',
  };
}
