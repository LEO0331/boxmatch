const { test, expect } = require('@playwright/test');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const baseUrl = process.env.BOXMATCH_E2E_BASE_URL || 'http://127.0.0.1:8787';
const project = 'boxmatch-e2224';
const uid = 'browser-smoke-user';

function recipientToken() {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    sub: uid, user_id: uid, aud: project,
    iss: `https://securetoken.google.com/${project}`,
    auth_time: now, iat: now, exp: now + 3600,
    firebase: { sign_in_provider: 'anonymous', identities: {} }
  };
  return `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.fixture`;
}

function fixtureHeaders(route) {
  return {
    'access-control-allow-origin': route.request().headers().origin || new URL(baseUrl).origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'authorization,content-type,cache-control,pragma,x-client-version,x-firebase-client,x-firebase-gmpid,x-firebase-appcheck',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'cache-control': 'no-store'
  };
}

function fixtureJson(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json',
    headers: fixtureHeaders(route), body: JSON.stringify(body) });
}

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
    const reservationRequests = [];
    // Exercise Flutter routing without relying on production API CORS/cold starts
    // or creating anonymous users in the live Firebase project.
    await page.route('**/health', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: '{"ok":true}',
      headers: { 'access-control-allow-origin': '*' }
    }));
    await page.route('**/telemetry/visit', (route) => route.fulfill({
      status: 204, headers: { 'access-control-allow-origin': '*',
        'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, OPTIONS' }
    }));
    await page.route('**/recipient/**', (route) => {
      if (route.request().method() === 'OPTIONS') {
        return route.fulfill({ status: 204, headers: fixtureHeaders(route) });
      }
      const auth = route.request().headers().authorization || '';
      const payload = route.request().postDataJSON();
      let claims = {};
      try {
        claims = JSON.parse(Buffer.from(auth.replace(/^Bearer /, '').split('.')[1], 'base64url').toString('utf8'));
      } catch (_) { /* reject malformed fixture credentials */ }
      if (new URL(route.request().url()).pathname === '/recipient/reservations/list') {
        reservationRequests.push({ subject: claims.sub, owner: payload?.claimerUid });
      }
      if (claims.sub !== uid || payload?.claimerUid !== uid) {
        return fixtureJson(route, { error: 'Fixture requires authenticated owner' }, 403);
      }
      return fixtureJson(route, { ok: true, reservations: [] });
    });
    // An idle mocked Firestore stream keeps this routing-only smoke independent
    // of live data. The browser context closes its pending requests after the test.
    await page.route('https://firestore.googleapis.com/**', () => {});
    await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({
      status: 200, contentType: 'image/png',
      body: readFileSync(path.join(__dirname, '../../web/favicon.png')),
      headers: { 'access-control-allow-origin': '*' }
    }));
    await page.route('https://identitytoolkit.googleapis.com/**', (route) => {
      if (route.request().method() === 'OPTIONS') {
        return route.fulfill({ status: 204, headers: fixtureHeaders(route) });
      }
      const url = route.request().url();
      if (url.includes('accounts:lookup')) {
        return fixtureJson(route, { users: [{
          localId: uid, emailVerified: false, providerUserInfo: [],
          createdAt: '1700000000000', lastLoginAt: '1700000000000'
        }] });
      }
      if (url.includes('accounts:signUp')) {
        return fixtureJson(route, {
          idToken: recipientToken(), localId: uid, registered: true,
          refreshToken: 'browser-smoke-refresh', expiresIn: '3600'
        });
      }
      return fixtureJson(route, { error: { message: 'OPERATION_NOT_ALLOWED' } }, 400);
    });
    await page.route('https://securetoken.googleapis.com/**', (route) => {
      if (route.request().method() === 'OPTIONS') {
        return route.fulfill({ status: 204, headers: fixtureHeaders(route) });
      }
      const token = recipientToken();
      return fixtureJson(route, {
        access_token: token, id_token: token, refresh_token: 'browser-smoke-refresh',
        expires_in: '3600', token_type: 'Bearer', user_id: uid, project_id: project
      });
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

    await expect.poll(() => reservationRequests.length, { timeout: 15000 }).toBeGreaterThan(0);
    expect(reservationRequests.every((entry) => entry.subject === uid && entry.owner === uid)).toBe(true);

    expect(consoleErrors, [
      'ERROR: Flutter web emitted runtime errors during smoke navigation.',
      'WHY: The web build must boot and route across core pages without global exceptions.',
      'FIX: Search the console error text for BOXMATCH_ERROR/Uncaught and patch the failing route or initialization path.',
      consoleErrors.join('\n')
    ].join('\n')).toEqual([]);
  });
});
