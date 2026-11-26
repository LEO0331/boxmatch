const { test, expect } = require('@playwright/test');

// Run against an explicitly telemetry-enabled build to exercise opt-in sends.
// The default build also runs this suite and verifies that no send occurs.
const enabled = process.env.BOXMATCH_E2E_TELEMETRY_ENABLED === 'true';
const baseUrl = process.env.BOXMATCH_E2E_BASE_URL || 'http://127.0.0.1:8787';

async function observeVisits(page, privacy) {
  const visits = [];
  // The application may initialize Firebase-backed repositories, but these
  // telemetry assertions never depend on cloud data or a live Render response.
  await page.route('https://firestore.googleapis.com/**', (route) => route.abort());
  await page.route('https://identitytoolkit.googleapis.com/**', (route) => route.abort());
  await page.route('**/enterprise/**', (route) => route.fulfill({
    status: 403, contentType: 'application/json', body: '{"error":"Test fixture"}'
  }));
  await page.route('**/recipient/**', (route) => route.fulfill({
    status: 401, contentType: 'application/json', body: '{"error":"Test fixture"}'
  }));
  await page.route('https://*.basemaps.cartocdn.com/**', (route) => route.abort());
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 204 }));
  await page.route('**/health', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: '{"ok":true}'
  }));
  if (privacy) {
    await page.addInitScript((setting) => {
      Object.defineProperty(navigator, setting, {
        configurable: true, get: () => setting === 'globalPrivacyControl' ? true : '1'
      });
    }, privacy);
  }
  await page.route('**/telemetry/visit', async (route) => {
    if (route.request().method() === 'POST') visits.push(route.request().postDataJSON());
    await route.fulfill({ status: 204, headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'POST, OPTIONS'
    } });
  });
  return visits;
}

async function boot(page, suffix = '') {
  await page.goto(`${baseUrl}/${suffix}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('flutter-view') ||
    document.querySelector('flt-glass-pane') || document.querySelector('[flt-renderer]'),
  null, { timeout: 30000 });
}

test('initial telemetry is opt-in, finite and excludes arbitrary URL data', async ({ page }) => {
  const visits = await observeVisits(page);
  await boot(page, '?utm_source=google&utm_medium=organic&gclid=PRIVATE_CLICK&utm_content=PRIVATE_AD');
  if (enabled) await expect.poll(() => visits.length).toBe(1);
  else await page.waitForTimeout(2500);
  expect(visits).toHaveLength(enabled ? 1 : 0);
  if (enabled) {
    expect(visits[0]).toEqual({ schemaVersion: 1, eventType: 'page_view', page: 'home',
      campaignSource: 'google', campaignMedium: 'organic' });
    expect(JSON.stringify(visits)).not.toContain('PRIVATE');
  }
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
  await page.evaluate(() => { location.hash = '/map'; });
  await page.waitForTimeout(500);
  expect(visits).toHaveLength(enabled ? 1 : 0);
});

for (const preference of ['globalPrivacyControl', 'doNotTrack']) {
  test(`${preference} suppresses even explicitly enabled telemetry`, async ({ page }) => {
    const visits = await observeVisits(page, preference);
    await boot(page);
    await page.waitForTimeout(2500);
    expect(visits).toHaveLength(0);
  });
}

test('token-bearing edit routes never submit telemetry', async ({ page }) => {
  const visits = await observeVisits(page);
  await boot(page, '#/enterprise/edit/PRIVATE_LISTING?token=PRIVATE_TOKEN');
  await page.waitForTimeout(2500);
  expect(visits).toHaveLength(0);
});
