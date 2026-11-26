const fs = require('node:fs');
const path = require('node:path');

test('Render runs the backend from the repository root with migration scripts available', () => {
  const root = path.resolve(__dirname, '../..');
  const blueprint = fs.readFileSync(path.join(root, 'render.yaml'), 'utf8');
  expect(blueprint).not.toMatch(/^\s*rootDir:\s*server\s*$/m);
  expect(blueprint).toContain('buildCommand: cd server && npm ci');
  expect(blueprint).toContain('startCommand: cd server && npm start');
  expect(fs.existsSync(path.join(root, 'scripts/migrate_listing_privacy.js'))).toBe(true);
  expect(fs.existsSync(path.join(root, 'server/observability/trafficCsv.js'))).toBe(true);
});
