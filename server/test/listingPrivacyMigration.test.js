const admin = require('./firebaseAdminMock');
const { migrateListingPrivacy } = require('../../scripts/migrate_listing_privacy');

const migrate = () => migrateListingPrivacy(admin.firestore(), admin.firestore.FieldValue);

describe('listing privacy migration', () => {
  beforeEach(() => admin.__reset());

  test('atomically removes public credentials and raw network identity while clearing legacy trust', async () => {
    admin.__seed('listings', 'legacy', {
      description: 'Public description', editTokenHash: 'existing-token-hash',
      enterpriseKey: 'ip:192.0.2.1', enterpriseVerified: true,
      enterpriseBadges: ['verified', 'quality_trusted', 'high_impact'],
      createdAt: new Date('2026-11-01T00:00:00Z')
    });

    expect(await migrate()).toEqual({ scanned: 1, migrated: 1 });
    const publicData = admin.__dump('listings')[0].data;
    const privateData = admin.__dump('listing_private')[0].data;
    expect(publicData).not.toHaveProperty('editTokenHash');
    expect(publicData).not.toHaveProperty('enterpriseKey');
    expect(publicData.description).toBe('Public description');
    expect(publicData.enterpriseVerified).toBe(false);
    expect(publicData.enterpriseBadges).toEqual(['high_impact']);
    expect(privateData.editTokenHash).toBe('existing-token-hash');
    expect(privateData.enterpriseKey).toMatch(/^legacy:[a-f0-9]{64}$/);
    expect(privateData.ownerUid).toBeNull();
    expect(JSON.stringify(admin.__dump('listing_private'))).not.toContain('192.0.2.1');
    expect(await migrate()).toEqual({ scanned: 1, migrated: 0 });
    expect(admin.__dump('listing_private')[0].data).toEqual(privateData);
  });

  test('preserves authoritative private revoked credentials and authenticated ownership', async () => {
    admin.__seed('listings', 'owned', {
      editTokenHash: 'stale-public-token', enterpriseKey: 'alias:old name',
      enterpriseVerified: true, enterpriseBadges: ['verified', 'quality_trusted']
    });
    admin.__seed('listing_private', 'owned', {
      editTokenHash: '', ownerUid: 'enterprise-owner', enterpriseKey: 'uid:enterprise-owner'
    });

    await migrate();
    expect(admin.__dump('listing_private')[0].data).toEqual({
      editTokenHash: '', ownerUid: 'enterprise-owner', enterpriseKey: 'uid:enterprise-owner'
    });
    expect(admin.__dump('listings')[0].data).toEqual({
      enterpriseVerified: true, enterpriseBadges: ['verified', 'quality_trusted']
    });
  });

  test('sanitizes an existing raw private alias without replacing its token', async () => {
    admin.__seed('listings', 'partial', { description: 'Already public' });
    admin.__seed('listing_private', 'partial', {
      enterpriseKey: 'alias:old trusted name', editTokenHash: 'private-token'
    });
    await migrate();
    const privateData = admin.__dump('listing_private')[0].data;
    expect(privateData.enterpriseKey).toMatch(/^legacy:[a-f0-9]{64}$/);
    expect(privateData.editTokenHash).toBe('private-token');
    expect(await migrate()).toEqual({ scanned: 1, migrated: 0 });
  });

  test('does not create credentials for a public listing with no legacy fields', async () => {
    admin.__seed('listings', 'public-only', { description: 'No credentials', enterpriseVerified: false });
    expect(await migrate()).toEqual({ scanned: 1, migrated: 0 });
    expect(admin.__dump('listing_private')).toEqual([]);
  });
});
