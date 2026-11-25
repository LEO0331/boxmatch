const path = require('path');
const { spawnSync } = require('child_process');

test('Admin adapter initializes the real modular SDK without contacting Firebase', () => {
  const script = `
    const assert = require('assert/strict');
    const admin = require('./firebaseAdmin');
    const { deleteApp } = require('firebase-admin/app');
    const app = admin.initializeApp({ projectId: 'boxmatch-local-smoke' });
    assert(admin.apps.includes(app));
    assert.equal(typeof admin.credential.cert, 'function');
    assert.equal(typeof admin.auth().verifyIdToken, 'function');
    assert.equal(admin.firestore().collection('listings').id, 'listings');
    assert(admin.firestore.FieldValue.increment(1));
    deleteApp(app).then(() => assert.equal(admin.apps.length, 0));
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8'
  });
  expect(result.error).toBeUndefined();
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
});

test('Admin adapter preserves the existing test double', () => {
  jest.isolateModules(() => {
    jest.doMock('firebase-admin', () => require('./firebaseAdminMock'));
    expect(require('../firebaseAdmin')).toBe(require('firebase-admin'));
  });
});
