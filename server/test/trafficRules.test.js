const fs = require('node:fs');
const path = require('node:path');

// Static policy regression checks. These do not replace Firestore emulator or
// deployed-rule validation with anonymous and authenticated client credentials.
const rules = fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8');

test.each(['traffic_daily', 'traffic_flushes'])('%s declares unconditional client read/write denial', (collection) => {
  const block = rules.match(new RegExp(`match /${collection}/\\{[^}]+\\}\\s*\\{([^}]+)\\}`));
  expect(block).not.toBeNull();
  expect(block[1].trim()).toBe('allow read, write: if false;');
});

test('analytics changes retain existing listing and reservation authorization', () => {
  expect(rules).toMatch(/match \/listings\/\{listingId\}[\s\S]*?allow read: if true;[\s\S]*?allow create, update, delete: if false;/);
  expect(rules).toContain('request.auth.uid == resource.data.claimerUid');
  expect(rules).not.toMatch(/match\s+\/\{[^}]+=\*\*\}/);
});
