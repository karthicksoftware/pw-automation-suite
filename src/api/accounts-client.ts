import type { APIRequestContext } from '@playwright/test';
import { messageSchema, userDetailsSchema } from '../domain/contracts.js';
import type { Credentials, UserDraft } from '../domain/models.js';
import { readResponse } from './read-response.js';

const ACCOUNT_ROUTES = {
  create: '/api/createAccount',
  details: '/api/getUserDetailByEmail',
  verifyLogin: '/api/verifyLogin',
  delete: '/api/deleteAccount',
} as const;

/** Maps domain fields to the registration API's form names; does not create an account. */
export function toCreateAccountForm(user: UserDraft) {
  return {
    name: user.name,
    email: user.email,
    password: user.password,
    title: user.title,
    birth_date: user.birthDate.day,
    birth_month: user.birthDate.month,
    birth_year: user.birthDate.year,
    firstname: user.firstName,
    lastname: user.lastName,
    company: user.company,
    address1: user.address1,
    address2: user.address2,
    country: user.country,
    zipcode: user.zipcode,
    state: user.state,
    city: user.city,
    mobile_number: user.mobileNumber,
  };
}

/** Whitelists credentials so passing a full user cannot send unrelated personal fields. */
export function toCredentialsForm(credentials: Credentials) {
  return { email: credentials.email, password: credentials.password };
}

/** Account operations using an injected request context; fixtures own account lifetime. */
export class AccountsClient {
  constructor(private readonly request: APIRequestContext) {}

  /** Creates a remote customer. Register cleanup before calling; success is business code 201. */
  async create(user: UserDraft) {
    const response = await this.request.post(ACCOUNT_ROUTES.create, {
      form: toCreateAccountForm(user),
    });
    return readResponse(response, messageSchema);
  }

  /** Retrieves and validates account details for an existing email address. */
  async getByEmail(email: string) {
    const response = await this.request.get(ACCOUNT_ROUTES.details, { params: { email } });
    return readResponse(response, userDetailsSchema);
  }

  /** Checks credentials without logging a browser in; invalid credentials return business code 404. */
  async verifyLogin(credentials: Credentials) {
    const response = await this.request.post(ACCOUNT_ROUTES.verifyLogin, {
      form: toCredentialsForm(credentials),
    });
    return readResponse(response, messageSchema);
  }

  /** Deletes an owned account; an already absent account returns business code 404. */
  async delete(credentials: Credentials) {
    const response = await this.request.delete(ACCOUNT_ROUTES.delete, {
      form: toCredentialsForm(credentials),
    });
    return readResponse(response, messageSchema);
  }
}
