import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { createUser } from '../../src/data/user-factory.js';
import { rupeesToPaise } from '../../src/domain/money.js';

await test('account identities stay unique across parallel workers and retries', () => {
  const users = Array.from({ length: 1000 }, (_, index) =>
    createUser('CI / run 42', index % 4, index % 2),
  );
  assert.equal(new Set(users.map((user) => user.email)).size, users.length);
  assert.ok(users.every((user) => z.email().safeParse(user.email).success));
  assert.ok(users.every((user) => user.email.includes('cirun42')));
});

await test('money calculations use integer paise and reject malformed amounts', () => {
  assert.equal(rupeesToPaise('Rs. 500'), 50_000);
  assert.equal(rupeesToPaise('Rs. 1,234.50'), 123_450);
  assert.equal(rupeesToPaise(' Rs. 0.1 '), 10);
  for (const value of [
    'free',
    'Rs. -10',
    'Rs. 1,23',
    'Rs. 1.234',
    'Rs. Infinity',
    'Rs. 99999999999999999999',
  ])
    assert.throws(() => rupeesToPaise(value));
});
