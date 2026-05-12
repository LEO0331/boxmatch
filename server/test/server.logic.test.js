jest.mock('firebase-admin', () => require('./firebaseAdminMock'));

const { __test } = require('../index');

describe('server pure logic', () => {
  test('validateAndBuildCreate reports missing required fields', () => {
    const { errors } = __test.validateAndBuildCreate({});
    expect(errors).toContain('Missing required field: venueId.');
    expect(errors).toContain('pickupPointText is required.');
  });

  test('validateAndBuildUpdate rejects non-positive quantity', () => {
    const { errors } = __test.validateAndBuildUpdate({ quantityTotal: 0 });
    expect(errors).toContain('quantityTotal must be a positive integer.');
  });

  test('resolveListingStatus handles completed, expired, reserved, active', () => {
    expect(
      __test.resolveListingStatus({
        currentStatus: 'completed',
        expiresAt: new Date(Date.now() + 100000),
        quantityRemaining: 3
      })
    ).toBe('completed');

    expect(
      __test.resolveListingStatus({
        currentStatus: 'active',
        expiresAt: new Date(Date.now() - 1000),
        quantityRemaining: 3
      })
    ).toBe('expired');

    expect(
      __test.resolveListingStatus({
        currentStatus: 'active',
        expiresAt: new Date(Date.now() + 100000),
        quantityRemaining: 0
      })
    ).toBe('reserved');

    expect(
      __test.resolveListingStatus({
        currentStatus: 'active',
        expiresAt: new Date(Date.now() + 100000),
        quantityRemaining: 2
      })
    ).toBe('active');
  });

  test('limit calculation for auth mode', () => {
    expect(__test.resolveRecipientDailyLimit('legacy')).toBe(2);
    expect(__test.resolveRecipientDailyLimit('token')).toBe(5);
  });

  test('badge helper weight estimate', () => {
    expect(__test.estimateKgFromItemType('Lunchbox', 2)).toBe(0.9);
    expect(__test.estimateKgFromItemType('Drink', 3)).toBe(0.9);
    expect(__test.estimateKgFromItemType('Unknown', 2)).toBe(0.7);
  });

  test('parseBearerToken extracts token', () => {
    expect(__test.parseBearerToken({ headers: {} })).toBeNull();
    expect(
      __test.parseBearerToken({ headers: { authorization: 'Bearer abc123' } })
    ).toBe('abc123');
  });

  test('randomDigits generates numeric pickup code with requested length', () => {
    expect(__test.randomDigits()).toMatch(/^\d{4}$/);
    expect(__test.randomDigits(6)).toMatch(/^\d{6}$/);
  });

  test('validateListingTimeline accepts Firestore-like timestamps', () => {
    const errors = [];
    __test.validateListingTimeline(
      {
        pickupStartAt: { toDate: () => new Date('2026-01-01T10:00:00Z') },
        pickupEndAt: { toDate: () => new Date('2026-01-01T09:00:00Z') },
        expiresAt: { toDate: () => new Date('2026-01-01T12:00:00Z') }
      },
      errors
    );

    expect(errors).toContain('pickupEndAt must be later than pickupStartAt.');
  });
});
