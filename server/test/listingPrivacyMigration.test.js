const admin = require('./firebaseAdminMock');
const { migrateListingPrivacy, ensureListingPrivacyMigration } = require('../../scripts/migrate_listing_privacy');

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

describe('versioned startup privacy migration', () => {
  beforeEach(() => admin.__reset());
  afterEach(() => jest.restoreAllMocks());

  const ensure = (options) => ensureListingPrivacyMigration(admin.firestore(), admin.firestore.FieldValue, options);

  test('publishes completion after success and skips all listing transactions on later starts', async () => {
    admin.__seed('listings', 'legacy', { editTokenHash: 'legacy-hash', enterpriseKey: 'alias:legacy' });
    expect(await ensure()).toEqual({ scanned: 1, migrated: 1, skipped: false });
    expect(admin.__dump('schema_migrations')[0].data).toMatchObject({ version: 1, completed: true });
    const transaction = jest.spyOn(admin.firestore(), 'runTransaction');
    expect(await ensure()).toEqual({ scanned: 0, migrated: 0, skipped: true });
    expect(transaction).not.toHaveBeenCalled();
  });

  test('failed scans never publish completion and next startup retries', async () => {
    admin.__seed('listings', 'legacy', { editTokenHash: 'legacy-hash' });
    jest.spyOn(admin.firestore(), 'runTransaction').mockRejectedValueOnce(new Error('unavailable'));
    await expect(ensure()).rejects.toThrow('unavailable');
    expect(admin.__dump('schema_migrations')).toEqual([]);
    expect(await ensure()).toMatchObject({ migrated: 1, skipped: false });
  });

  test('invalid markers do not bypass migration; operator force rescans completed migrations', async () => {
    admin.__seed('schema_migrations', 'listing_privacy_v1', { version: 0, completed: true });
    expect(await ensure()).toMatchObject({ skipped: false });
    admin.__seed('listings', 'imported', { editTokenHash: 'imported-hash' });
    expect(await ensure({ force: true })).toMatchObject({ migrated: 1, skipped: false });
    expect(admin.__dump('listings')[0].data).not.toHaveProperty('editTokenHash');
  });
});

test('failed forced rescan invalidates a previously complete marker and retries on startup', async () => {
  admin.__reset();
  const ensure = (options) => ensureListingPrivacyMigration(admin.firestore(), admin.firestore.FieldValue, options);
  await ensure();
  admin.__seed('listings', 'legacy-import', { editTokenHash: 'legacy-hash' });
  const transaction = jest.spyOn(admin.firestore(), 'runTransaction').mockRejectedValueOnce(new Error('unavailable'));
  try {
    await expect(ensure({ force: true })).rejects.toThrow('unavailable');
    expect(admin.__dump('schema_migrations')[0].data.completed).toBe(false);
    expect(await ensure()).toMatchObject({ migrated: 1, skipped: false });
  } finally {
    transaction.mockRestore();
  }
});
