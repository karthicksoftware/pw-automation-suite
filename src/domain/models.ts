export interface Credentials {
  readonly email: string;
  readonly password: string;
}

export interface UserDraft extends Credentials {
  readonly name: string;
  readonly title: 'Mr' | 'Mrs';
  readonly birthDate: { readonly day: string; readonly month: string; readonly year: string };
  readonly firstName: string;
  readonly lastName: string;
  readonly company: string;
  readonly address1: string;
  readonly address2: string;
  readonly country: string;
  readonly state: string;
  readonly city: string;
  readonly zipcode: string;
  readonly mobileNumber: string;
}

export type Account = UserDraft;

export interface PaymentDetails {
  readonly nameOnCard: string;
  readonly cardNumber: string;
  readonly cvc: string;
  readonly expiryMonth: string;
  readonly expiryYear: string;
}
