const { parseOptions, validateUid, manageTrafficAdmin } = require('../../scripts/manage_traffic_admin');

function fixture(account = {}) {
  return {
    getUser: jest.fn(async () => ({ uid: 'test-account', disabled: false,
      providerData: [{ providerId: 'password' }], customClaims: { unrelated: 'preserved' }, ...account })),
    setCustomUserClaims: jest.fn(async () => {}),
    revokeRefreshTokens: jest.fn(async () => {})
  };
}

test('requires an explicit action and target without automatic provisioning', () => {
  expect(parseOptions(['grant', '--uid', 'test-account'])).toEqual({ action: 'grant', uid: 'test-account' });
  expect(parseOptions(['revoke', '--uid', 'test-account']).action).toBe('revoke');
  for (const args of [[], ['grant'], ['grant', '--email', 'a@example.invalid'],
    ['grant', '--uid', 'test-account', '--force'], ['delete', '--uid', 'test-account']]) {
    expect(() => parseOptions(args)).toThrow('Usage:');
  }
});

test.each(['', ' ', ' target', 'target ', 'x'.repeat(129), 'line\nbreak', null, {}, 12])(
  'rejects invalid operator UID %j', (uid) => expect(() => validateUid(uid)).toThrow()
);

test('grant preserves unrelated claims and sets only the strict traffic privilege', async () => {
  const auth = fixture({ customClaims: { unrelated: 'preserved', trafficAdmin: 'false', enterpriseRole: true } });
  expect(await manageTrafficAdmin(auth, { action: 'grant', uid: 'test-account' }))
    .toEqual({ action: 'grant', updated: true, sessionsRevoked: false });
  expect(auth.getUser).toHaveBeenCalledWith('test-account');
  expect(auth.setCustomUserClaims).toHaveBeenCalledWith('test-account', {
    unrelated: 'preserved', trafficAdmin: true, enterpriseRole: true
  });
  expect(auth.revokeRefreshTokens).not.toHaveBeenCalled();
});

test('revoke preserves unrelated claims, removes the privilege and invalidates sessions', async () => {
  const auth = fixture({ customClaims: { unrelated: 'preserved', trafficAdmin: true } });
  expect(await manageTrafficAdmin(auth, { action: 'revoke', uid: 'test-account' }))
    .toEqual({ action: 'revoke', updated: true, sessionsRevoked: true });
  expect(auth.setCustomUserClaims).toHaveBeenCalledWith('test-account', { unrelated: 'preserved' });
  expect(auth.revokeRefreshTokens).toHaveBeenCalledWith('test-account');
  expect(auth.setCustomUserClaims.mock.invocationCallOrder[0])
    .toBeLessThan(auth.revokeRefreshTokens.mock.invocationCallOrder[0]);
});

test.each([[], undefined, [{ providerId: 'anonymous' }], [{ providerId: null }]])(
  'anonymous or unlinked accounts cannot be provisioned or revoked through this tool: %j', async (providerData) => {
    for (const action of ['grant', 'revoke']) {
      const auth = fixture({ providerData });
      await expect(manageTrafficAdmin(auth, { action, uid: 'test-account' })).rejects.toThrow('non-anonymous');
      expect(auth.setCustomUserClaims).not.toHaveBeenCalled();
      expect(auth.revokeRefreshTokens).not.toHaveBeenCalled();
    }
  }
);

test('nonexistent users fail before modifying claims', async () => {
  const auth = fixture();
  auth.getUser.mockRejectedValueOnce(new Error('auth/user-not-found'));
  await expect(manageTrafficAdmin(auth, { action: 'grant', uid: 'test-account' })).rejects.toThrow();
  expect(auth.setCustomUserClaims).not.toHaveBeenCalled();
});

test('disabled accounts cannot be granted but can have privileges removed', async () => {
  const auth = fixture({ disabled: true });
  await expect(manageTrafficAdmin(auth, { action: 'grant', uid: 'test-account' })).rejects.toThrow('disabled');
  await expect(manageTrafficAdmin(auth, { action: 'revoke', uid: 'test-account' })).resolves.toMatchObject({ sessionsRevoked: true });
});

test('failed claim writes do not report success or revoke before claim removal', async () => {
  const auth = fixture();
  auth.setCustomUserClaims.mockRejectedValueOnce(new Error('SDK_PRIVATE_DETAIL'));
  await expect(manageTrafficAdmin(auth, { action: 'revoke', uid: 'test-account' })).rejects.toThrow();
  expect(auth.revokeRefreshTokens).not.toHaveBeenCalled();
});

test('revocation failure remains visible to the operator instead of claiming success', async () => {
  const auth = fixture();
  auth.revokeRefreshTokens.mockRejectedValueOnce(new Error('SDK_PRIVATE_DETAIL'));
  await expect(manageTrafficAdmin(auth, { action: 'revoke', uid: 'test-account' })).rejects.toThrow();
});

test('output contains no target identity or claim contents', async () => {
  const result = await manageTrafficAdmin(fixture(), { action: 'grant', uid: 'test-account' });
  expect(JSON.stringify(result)).not.toMatch(/test-account|unrelated|preserved/);
});
