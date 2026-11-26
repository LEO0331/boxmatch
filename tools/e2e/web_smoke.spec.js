const { test, expect } = require('@playwright/test');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const baseUrl = process.env.BOXMATCH_E2E_BASE_URL || 'http://127.0.0.1:8787';

async function openFlutterRoute(page, route = '') {
  await page.goto(`${baseUrl}/${route}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toBeVisible();
  await page.waitForFunction(
    () =>
      document.querySelector('flutter-view') ||
      document.querySelector('flt-glass-pane') ||
      document.querySelector('[flt-renderer]') ||
      document.body?.innerText?.includes('Enable accessibility'),
    null,
    { timeout: 30_000 }
  );
}

test.describe('Boxmatch Flutter web smoke', () => {
  test('loads core routes without global runtime errors', async ({ page }) => {
    const consoleErrors = [];
    // Exercise Flutter routing without relying on production API CORS/cold starts
    // or creating anonymous users in the live Firebase project.
    await page.route('**/health', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: '{"ok":true}',
      headers: { 'access-control-allow-origin': '*' }
    }));
    await page.route('**/recipient/**', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: '{"ok":true,"reservations":[]}',
      headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type,authorization' }
    }));
    // An idle mocked Firestore stream keeps this routing-only smoke independent
    // of live data. The browser context closes its pending requests after the test.
    await page.route('https://firestore.googleapis.com/**', () => {});
    await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({
      status: 200, contentType: 'image/png',
      body: readFileSync(path.join(__dirname, '../../web/favicon.png')),
      headers: { 'access-control-allow-origin': '*' }
    }));
    await page.route('https://identitytoolkit.googleapis.com/**', (route) => {
      const claims = { sub: 'browser-smoke-user', user_id: 'browser-smoke-user',
        iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 };
      const idToken = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.fixture`;
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ idToken, localId: claims.sub, refreshToken: 'fixture', expiresIn: '3600' }),
        headers: { 'access-control-allow-origin': new URL(baseUrl).origin,
          'access-control-allow-credentials': 'true' } });
    });
    page.on('console', (message) => {
      const text = message.text();
      if (
        message.type() === 'error' ||
        text.includes('BOXMATCH_ERROR') ||
        text.includes('Uncaught')
      ) {
        consoleErrors.push(text);
      }
    });
    page.on('pageerror', (error) => {
      consoleErrors.push(error.message);
    });

    await openFlutterRoute(page);
    await expect(page).toHaveTitle(/Boxmatch|展場剩食|Surplus/i);

    for (const route of ['#/map', '#/enterprise/new', '#/my-reservations']) {
      await openFlutterRoute(page, route);
    }

    expect(consoleErrors, [
      'ERROR: Flutter web emitted runtime errors during smoke navigation.',
      'WHY: The web build must boot and route across core pages without global exceptions.',
      'FIX: Search the console error text for BOXMATCH_ERROR/Uncaught and patch the failing route or initialization path.',
      consoleErrors.join('\n')
    ].join('\n')).toEqual([]);
  });
});
