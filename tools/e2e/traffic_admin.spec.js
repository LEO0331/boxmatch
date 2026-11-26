const { test, expect } = require('@playwright/test');
const { mkdirSync } = require('node:fs');
const path = require('node:path');
const { trafficOverview, probeOverview } = require('./fixtures/traffic_overview');
const { readFile } = require('node:fs/promises');

const enabled = process.env.BOXMATCH_E2E_TRAFFIC_ADMIN_ENABLED === 'true';
const baseUrl = (process.env.BOXMATCH_E2E_BASE_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const hostedUrl = `${baseUrl}/boxmatch/`;
const project = 'boxmatch-e2224';
const email = 'traffic-fixture@example.invalid';
test.use({ actionTimeout: 10000 });

function token(uid, administrator) {
  const now = Math.floor(Date.now() / 1000);
  const claims = { sub: uid, user_id: uid, aud: project,
    iss: `https://securetoken.google.com/${project}`, auth_time: now, iat: now, exp: now + 3600,
    firebase: { sign_in_provider: administrator ? 'password' : 'anonymous', identities: administrator ? { email: [email] } : {} },
    ...(administrator ? { trafficAdmin: true, email, email_verified: true } : {}) };
  return `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.fixture`;
}

function claimsFrom(value) {
  try { return JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString('utf8')); }
  catch (_) { return {}; }
}

async function installFixtures(page, options = {}) {
  const state = { overview: [], exports: 0, visits: [], signups: 0, reject: false,
    hold: Boolean(options.hold), release: null, recipientSubjects: [] };
  await page.addInitScript((language) => {
    localStorage.setItem('flutter.boxmatch.language', JSON.stringify(language));
  }, options.language || 'en');
  // Serve the same build under Pages' real mount point, including refreshes.
  await page.route(`${baseUrl}/boxmatch/**`, async (route) => {
    const url = new URL(route.request().url());
    url.pathname = url.pathname.replace(/^\/boxmatch(?=\/|$)/, '') || '/';
    const response = await route.fetch({ url: url.toString() });
    return route.fulfill({ response });
  });
  const headers = (route) => ({ 'access-control-allow-origin': route.request().headers().origin || new URL(baseUrl).origin,
    'access-control-allow-credentials': 'true', 'access-control-allow-headers':
      'authorization,content-type,cache-control,pragma,x-client-version,x-firebase-client,x-firebase-gmpid,x-firebase-appcheck',
    'access-control-allow-methods': 'GET,POST,OPTIONS', 'cache-control': 'private, no-store', vary: 'Authorization' });
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json',
    headers: headers(route), body: JSON.stringify(body) });
  await page.route('https://firestore.googleapis.com/**', () => {});
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 204 }));
  await page.route('**/health', (route) => json(route, { ok: true }));
  await page.route('https://identitytoolkit.googleapis.com/**', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: headers(route) });
    const url = route.request().url();
    const body = route.request().postDataJSON() || {};
    if (url.includes('accounts:lookup')) {
      const claims = claimsFrom(body.idToken || '');
      const administrator = claims.trafficAdmin === true;
      return json(route, { users: [{ localId: claims.sub || 'fixture-admin', email: administrator ? email : undefined,
        emailVerified: administrator, providerUserInfo: administrator ? [{ providerId: 'password', email, federatedId: email }] : [],
        createdAt: '1700000000000', lastLoginAt: '1700000000000' }] });
    }
    const administrator = url.includes('accounts:signInWithPassword');
    if (!administrator) state.signups++;
    const uid = administrator ? 'fixture-admin' : 'fixture-recipient';
    return json(route, { localId: uid, email: administrator ? email : undefined,
      registered: true, idToken: token(uid, administrator), refreshToken: `${uid}-refresh`, expiresIn: '3600' });
  });
  await page.route('https://securetoken.googleapis.com/**', (route) => json(route, {
    access_token: token('fixture-admin', true), id_token: token('fixture-admin', true),
    refresh_token: 'fixture-admin-refresh', expires_in: '3600', token_type: 'Bearer', user_id: 'fixture-admin', project_id: project
  }));
  await page.route('**/recipient/**', (route) => {
    const auth = route.request().headers().authorization || '';
    state.recipientSubjects.push(claimsFrom(auth.replace(/^Bearer /, '')).sub || null);
    return json(route, { ok: true, reservations: [] });
  });
  await page.route('**/enterprise/**', (route) => json(route, { error: 'Fixture only' }, 403));
  await page.route('**/telemetry/visit', (route) => {
    if (route.request().method() === 'POST') state.visits.push(route.request().postDataJSON());
    return route.fulfill({ status: 204, headers: headers(route) });
  });
  await page.route('**/admin/traffic/**', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: headers(route) });
    const auth = route.request().headers().authorization || '';
    if (claimsFrom(auth.replace(/^Bearer /, '')).trafficAdmin !== true || state.reject) {
      return json(route, { error: 'Administrator access required.', code: 'ADMIN_FORBIDDEN' }, 403);
    }
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/export')) {
      state.exports++;
      return route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', headers: {
        ...headers(route), 'content-disposition': 'attachment; filename="traffic-fixture.csv"'
      }, body: 'dayKey,stream,dimension,key,count,status\n2026-11-26,website,totals,pageViews,140,available\n' + (options.probes ? '2026-11-26,probes,probeTargets,environment,3,available\n' : '') });
    }
    const days = Number(url.searchParams.get('days') || 7);
    state.overview.push(days);
    if (state.hold) {
      state.hold = false;
      await new Promise((resolve) => { state.release = resolve; });
    }
    return json(route, options.probes ? probeOverview(days) : trafficOverview(days));
  });
  return state;
}

async function boot(page, route = '/admin/login') {
  await page.goto(`${hostedUrl}#${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('flutter-view') || document.querySelector('flt-glass-pane'), null, { timeout: 30000 });
  await page.evaluate(() => document.querySelector('flt-semantics-placeholder')?.click());
}

async function signIn(page, chinese = false) {
  const address = chinese ? '電子郵件' : 'Email';
  const password = chinese ? '密碼' : 'Password';
  await expect(page.getByRole('textbox', { name: address, exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: address, exact: true }).click();
  await page.keyboard.type(email);
  await page.getByRole('textbox', { name: password, exact: true }).click();
  await page.keyboard.type('fixture-password-only');
  await page.getByRole('button', { name: chinese ? '登入' : 'Sign in', exact: true }).click();
}

async function dashboard(page) {
  await expect(page.getByText('Traffic Intelligence Dashboard', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Persisted days:/)).toBeVisible();
}

async function changePeriod(page, days) {
  await page.getByRole('button', { name: /^Date range \(UTC\)/ }).click();
  await page.getByRole('menuitem', { name: `${days} days`, exact: true }).click();
}

async function labelFixture(page) {
  await page.evaluate(() => {
    const banner = document.createElement('div');
    banner.textContent = 'TEST FIXTURE — synthetic traffic analytics';
    banner.style.cssText = 'position:fixed;z-index:2147483647;bottom:4px;left:4px;right:4px;background:#fff3cd;color:#563d00;border:1px solid #c99e38;padding:5px 10px;font:12px sans-serif;text-align:center;pointer-events:none';
    document.body.appendChild(banner);
  });
}

async function scrollToHeading(page, title) {
  const heading = page.getByRole('heading', { name: title, exact: true });
  for (let step = 0; step < 70; step++) {
    const box = await heading.count() ? await heading.boundingBox() : null;
    if (box && box.y >= 0 && box.y < page.viewportSize().height - 90) {
      await expect(heading).toBeVisible();
      if (box.y > 110) {
        await page.mouse.wheel(0, box.y - 80);
        await page.waitForTimeout(150);
      }
      return;
    }
    await page.mouse.wheel(0, Math.round(page.viewportSize().height * 0.65));
    await page.waitForTimeout(100);
  }
  await expect(heading, `The ${title} section must be reachable through the dashboard scroll view.`).toBeInViewport();
}

async function persistedBrowserState(page) {
  return page.evaluate(async () => {
    const stores = { local: { ...localStorage }, session: { ...sessionStorage }, indexed: [] };
    const databases = await indexedDB.databases();
    for (const info of databases.filter((entry) => entry.name?.includes('firebaseLocalStorageDb'))) {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open(info.name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        for (const name of database.objectStoreNames) {
          const values = await new Promise((resolve, reject) => {
            const request = database.transaction(name, 'readonly').objectStore(name).getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          stores.indexed.push(...values);
        }
      } finally { database.close(); }
    }
    return JSON.stringify(stores);
  });
}

test('administrator UI is absent from the default-disabled public build', async ({ page }) => {
  test.skip(enabled, 'Runs against the default-disabled build.');
  const state = await installFixtures(page);
  await boot(page, '/admin/traffic');
  await page.waitForTimeout(1000);
  await expect(page.getByText('Traffic Intelligence Dashboard', { exact: true })).toHaveCount(0);
  expect(state.overview).toEqual([]);
  expect(state.visits).toEqual([]);
});

test.describe('administrator-enabled build with synthetic services', () => {
  test.skip(!enabled, 'Requires BOXMATCH_ENABLE_TRAFFIC_ADMIN=true web build.');

  test('direct route, login, period selection, export and sign-out preserve privacy', async ({ page }) => {
    const state = await installFixtures(page);
    await boot(page, '/admin/traffic');
    expect(state.overview).toEqual([]);
    await signIn(page);
    await dashboard(page);
    expect(state.overview).toEqual([7]);
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect.poll(() => state.overview).toEqual([7, 7]);
    await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Export CSV', exact: true })).toBeEnabled();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'strict-origin');
    await changePeriod(page, 30);
    await expect.poll(() => state.overview.at(-1)).toBe(30);
    await changePeriod(page, 90);
    await expect.poll(() => state.overview.at(-1)).toBe(90);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
    const csv = await download;
    expect(csv.suggestedFilename()).toMatch(/traffic.*\.csv$/);
    expect(await csv.failure()).toBeNull();
    expect(state.exports).toBe(1);
    expect(state.visits).toEqual([]);
    expect(state.signups).toBe(0);
    const persisted = await persistedBrowserState(page);
    expect(persisted).not.toMatch(/fixture-admin|trafficAdmin|fixture-password|pageViews/);
    const cachedUrls = await page.evaluate(async () => {
      const urls = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        urls.push(...(await cache.keys()).map((request) => request.url));
      }
      return urls;
    });
    expect(cachedUrls.filter((url) => /\/admin\/traffic\/(?:overview|export)/.test(url))).toEqual([]);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toBeVisible();
    await expect(page.getByText(/^Persisted days:/)).toHaveCount(0);
  });

  test('an expired privilege clears dashboard data instead of retaining a snapshot', async ({ page }) => {
    const state = await installFixtures(page);
    await boot(page);
    await signIn(page);
    await dashboard(page);
    state.reject = true;
    await changePeriod(page, 30);
    await expect(page.getByText(/^Persisted days:/)).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toBeVisible();
  });

  test('late overview responses cannot restore data after logout', async ({ page }) => {
    const state = await installFixtures(page, { hold: true });
    await boot(page);
    await signIn(page);
    await expect.poll(() => Boolean(state.release)).toBe(true);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    state.release();
    await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page.getByText(/^Persisted days:/)).toHaveCount(0);
  });

  test('administrator sign-in preserves the public anonymous recipient identity', async ({ page }) => {
    const state = await installFixtures(page);
    await boot(page, '/my-reservations');
    await expect.poll(() => state.recipientSubjects.includes('fixture-recipient')).toBe(true);
    await page.evaluate(() => { location.hash = '/admin/login'; });
    await signIn(page);
    await dashboard(page);
    const previous = state.recipientSubjects.length;
    await page.evaluate(() => { location.hash = '/my-reservations'; });
    await expect.poll(() => state.recipientSubjects.length).toBeGreaterThan(previous);
    expect(state.recipientSubjects.at(-1)).toBe('fixture-recipient');
    expect(state.recipientSubjects).not.toContain('fixture-admin');
  });

  test('protected probe panel renders synthetic aggregates and exports probe CSV', async ({ page }) => {
    const state = await installFixtures(page, { probes: true });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await boot(page, '/admin/traffic');
    expect(state.overview).toEqual([]);
    await signIn(page);
    await dashboard(page);
    await scrollToHeading(page, 'Security Probe Intelligence');
    await expect(page.getByText('Collection enabled', { exact: true })).toBeVisible();
    await expect(page.getByText('Matched probes', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Repeat probe requests', { exact: true })).toBeVisible();
    await expect(page.getByText('Probe 2xx responses', { exact: true })).toBeVisible();
    await page.mouse.move(700, 500);
    await page.mouse.wheel(0, -100000);
    await page.waitForTimeout(200);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
    const csv = await download;
    expect(await csv.failure()).toBeNull();
    expect(await readFile(await csv.path(), 'utf8')).toContain(',probes,probeTargets,environment,3,available');
    expect(state.visits).toEqual([]);
  });

  test('Traditional Chinese sign-in and dashboard labels follow the existing language preference', async ({ page }) => {
    const state = await installFixtures(page, { language: 'zh-TW' });
    await boot(page);
    await expect(page.getByText('管理員登入', { exact: true })).toBeVisible();
    await signIn(page, true);
    await expect(page.getByText('流量情報儀表板', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^日期範圍（UTC）/ })).toBeVisible();
    expect(state.visits).toEqual([]);
  });

  test('desktop and mobile deep sections remain reachable without rendering errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (/RenderFlex overflow|overflowed by|EXCEPTION CAUGHT BY RENDERING/i.test(message.text())) errors.push(message.text());
    });
    await page.setViewportSize({ width: 1440, height: 1100 });
    const state = await installFixtures(page);
    await boot(page);
    await signIn(page);
    await dashboard(page);
    await labelFixture(page);
    const directory = path.resolve(__dirname, '../../artifacts/traffic-dashboard');
    mkdirSync(directory, { recursive: true });
    for (const [name, viewport] of Object.entries({ desktop: { width: 1440, height: 1100 }, mobile: { width: 390, height: 844 } })) {
      await page.setViewportSize(viewport);
      await page.mouse.move(viewport.width / 2, viewport.height / 2);
      await page.mouse.wheel(0, -100000);
      await page.waitForTimeout(200);
      for (const section of ['Website acquisition', 'API client intelligence', 'Geographic intelligence',
        'Security observations', 'Browsers and operating systems', 'Data quality']) {
        await scrollToHeading(page, section);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (section === 'Geographic intelligence') {
          await expect(page.getByText('API countries', { exact: true })).toBeVisible();
          await page.screenshot({ path: path.join(directory, `${name}-geography.png`), fullPage: true });
        }
      }
    }
    expect(errors).toEqual([]);
    expect(state.visits).toEqual([]);
  });

  for (const [name, viewport] of Object.entries({ desktop: { width: 1440, height: 1100 }, tablet: { width: 900, height: 1100 }, mobile: { width: 390, height: 844 } })) {
    test(`responsive ${name} dashboard fixture and screenshot`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (/RenderFlex overflow|overflowed by|EXCEPTION CAUGHT BY RENDERING/i.test(message.text())) errors.push(message.text());
      });
      const state = await installFixtures(page);
      await boot(page);
      await signIn(page);
      await dashboard(page);
      expect(errors).toEqual([]);
      expect(state.visits).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await labelFixture(page);
      const directory = path.resolve(__dirname, '../../artifacts/traffic-dashboard');
      mkdirSync(directory, { recursive: true });
      await page.screenshot({ path: path.join(directory, `${name}.png`), fullPage: true });
    });
  }
});
