jest.mock('../firebaseAdmin', () => require('./firebaseAdminMock'));
const { normalizeOwnerUid } = require('../../scripts/seed_verified_enterprises');

describe('verified enterprise ownership seed validation', () => {
  test.each([null, undefined])('missing owner %s stays unbound', (value) => {
    expect(normalizeOwnerUid(value)).toBeNull();
  });

  test('uses the explicitly supplied UID', () => {
    expect(normalizeOwnerUid(' enterprise-owner ')).toBe('enterprise-owner');
  });

  test.each(['', '   ', false, 123, {}, [], 'x'.repeat(129)])(
    'rejects invalid owner %p', (value) => {
      expect(() => normalizeOwnerUid(value)).toThrow('ownerUid must be');
    }
  );
});
