import type { Page } from '@playwright/test';
import { AuthPage } from './auth-page.js';
import { RegistrationPage } from './registration-page.js';
import { ProductsPage } from './products-page.js';
import { ProductDetailsPage } from './product-details-page.js';
import { CartPage } from './cart-page.js';
import { CheckoutPage } from './checkout-page.js';
import { PaymentPage } from './payment-page.js';
import { Header } from './components/header.js';
import { CartModal } from './components/cart-modal.js';

/** Composition root for UI capabilities. No shared browser state or singleton pages. */
export class Application {
  readonly auth;
  readonly registration;
  readonly products;
  readonly productDetails;
  readonly cart;
  readonly checkout;
  readonly payment;
  readonly header;
  readonly cartModal;

  constructor(page: Page) {
    this.auth = new AuthPage(page);
    this.registration = new RegistrationPage(page);
    this.products = new ProductsPage(page);
    this.productDetails = new ProductDetailsPage(page);
    this.cart = new CartPage(page);
    this.checkout = new CheckoutPage(page);
    this.payment = new PaymentPage(page);
    this.header = new Header(page);
    this.cartModal = new CartModal(page);
  }
}
