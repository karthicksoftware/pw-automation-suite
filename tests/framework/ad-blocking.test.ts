import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isGoogleAdUrl } from '../../src/fixtures/test.js';

await test('blocks Google ad domains and their subdomains, including the observed script and frame hosts', () => {
  for (const address of [
    'https://doubleclick.net/',
    'https://googleads.g.doubleclick.net/pagead/ads',
    'https://googlesyndication.com/',
    'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js',
    'http://tpc.googlesyndication.com/ad-frame.html',
    'https://PAGEAD2.GOOGLESYNDICATION.COM/pagead/js/adsbygoogle.js',
  ]) {
    assert.equal(isGoogleAdUrl(new URL(address)), true, address);
  }
});

await test('preserves application journeys, API endpoints, and unrelated Google resources', () => {
  for (const address of [
    'https://automationexercise.com/',
    'https://automationexercise.com/login',
    'https://automationexercise.com/payment',
    'https://automationexercise.com/api/productsList',
    'https://automationexercise.com/api/createAccount',
    'https://automationexercise.com/api/deleteAccount',
    'https://fonts.googleapis.com/css',
    'https://fonts.gstatic.com/font.woff2',
    'https://www.google.com/recaptcha/api2/aframe',
    'https://static.cloudflareinsights.com/beacon.min.js',
  ]) {
    assert.equal(isGoogleAdUrl(new URL(address)), false, address);
  }
});

await test('does not match deceptive host suffixes or ad domains in paths, queries, or credentials', () => {
  for (const address of [
    'https://notdoubleclick.net/',
    'https://doubleclick.net.example.com/',
    'https://googlesyndication.com.example.com/',
    'https://automationexercise.com/doubleclick.net',
    'https://automationexercise.com/?redirect=https://googleads.g.doubleclick.net',
    'https://doubleclick.net@example.com/',
  ]) {
    assert.equal(isGoogleAdUrl(new URL(address)), false, address);
  }
});
