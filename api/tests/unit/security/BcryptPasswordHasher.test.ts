import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BcryptPasswordHasher } from '../../../src/infrastructure/security/BcryptPasswordHasher.js';

describe('BcryptPasswordHasher', () => {
  it('hashes with bcrypt and compares only the matching password', async () => {
    const hasher = new BcryptPasswordHasher();
    const password = 'synthetic-test-password-not-a-credential';

    const hash = await hasher.hash(password);

    assert.match(hash, /^\$2[aby]\$12\$/);
    assert.notEqual(hash, password);
    assert.equal(await hasher.compare(password, hash), true);
    assert.equal(await hasher.compare('incorrect-password', hash), false);
  });
});
